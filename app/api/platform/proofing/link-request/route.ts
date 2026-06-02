import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { regenerateApprovalLink } from "@/lib/platform/magic-link";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalRequestEmail } from "@/lib/email/templates/social-approval-request";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/proofing/link-request
//
// Self-serve re-request of magic links for all open proofs awaiting a
// reviewer's decision. Called from /proof/request after the reviewer
// enters their email. Returns { ok: true } regardless of whether any
// open proofs were found (prevents enumeration).
//
// Public route. Rate-limited per email + IP.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit("magic-link-login", ip); // reuse existing limiter
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const svc = getServiceRoleClient();

  // Find all open (non-finalised, non-revoked) recipients for this email.
  const { data: recipients } = await svc
    .from("social_approval_recipients")
    .select("id, approval_request_id, name")
    .eq("email", email)
    .is("revoked_at", null);

  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  for (const r of recipients as Array<{ id: string; approval_request_id: string; name: string | null }>) {
    // Check the parent request is still open.
    const { data: req_row } = await svc
      .from("social_approval_requests")
      .select("id, company_id, expires_at, final_approved_at, final_rejected_at, revoked_at")
      .eq("id", r.approval_request_id)
      .maybeSingle();

    if (!req_row) continue;
    const row = req_row as {
      id: string;
      company_id: string;
      expires_at: string;
      final_approved_at: string | null;
      final_rejected_at: string | null;
      revoked_at: string | null;
    };

    if (row.final_approved_at || row.final_rejected_at || row.revoked_at) continue;
    if (new Date(row.expires_at).getTime() < Date.now()) continue;

    // Issue a fresh magic link.
    try {
      const { rawToken } = await regenerateApprovalLink(r.id);
      const reviewUrl = `${req.nextUrl.origin}/approve/${rawToken}`;

      const { data: company } = await svc
        .from("platform_companies")
        .select("name")
        .eq("id", row.company_id)
        .maybeSingle();

      const companyName = (company as { name: string } | null)?.name ?? "Your review";
      const { subject, html, text } = renderSocialApprovalRequestEmail({
        recipient_email: email,
        recipient_name: r.name,
        company_name: companyName,
        review_url: reviewUrl,
        expires_at: row.expires_at,
        reviewerRole: "Reviewer",
      });

      await sendEmail({ to: email, subject, html, text });
    } catch (err) {
      logger.error("proofing.link_request.regenerate_failed", {
        recipientId: r.id,
        err: String(err),
      });
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
