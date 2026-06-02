import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/email/sendgrid";
import { renderMagicLinkLoginEmail } from "@/lib/email/templates/magic-link-login";
import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { issue } from "@/lib/platform/magic-link";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/magic-link/login
//
// Passwordless magic-link login issuance. Validates the email belongs to a
// platform user, issues a magic_links row (purpose='login'), and sends a
// sign-in email. Returns { ok: true } regardless of whether the email
// matched a user (prevents enumeration). Rate-limited per email + IP.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit("magic-link-login", ip);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const email = parsed.data.email.toLowerCase().trim();

  const svc = getServiceRoleClient();
  const { data: user } = await svc
    .from("platform_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!user) {
    // Deliberately return ok to prevent email enumeration
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let rawToken: string;
  let link: { expires_at: string };
  try {
    const result = await issue({
      purpose: "login",
      subjectType: "user",
      subjectId: user.id,
      email,
    });
    rawToken = result.rawToken;
    link = result.link;
  } catch (err) {
    logger.error("magic_link.login.issue_failed", { err: String(err) });
    return internalError("Failed to issue login link.");
  }

  const origin = req.nextUrl.origin;
  const loginUrl = `${origin}/magic-link/login?token=${rawToken}`;

  try {
    const { subject, html, text } = renderMagicLinkLoginEmail({
      recipient_email: email,
      login_url: loginUrl,
      expires_at: link.expires_at,
    });
    await sendEmail({ to: email, subject, html, text });
  } catch (err) {
    logger.error("magic_link.login.email_failed", { err: String(err) });
    return internalError("Failed to send login email.");
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
