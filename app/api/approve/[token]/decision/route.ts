import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notFound, readJsonBody, respond, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { dispatch } from "@/lib/platform/notifications";
import { recordApprovalDecision } from "@/lib/platform/social/approvals";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-7 — POST /api/approve/[token]/decision
//
// Public route. Token IS the auth — verifyQstashSignature pattern but
// for approval magic links: SHA-256 hash compared against
// social_approval_recipients.token_hash inside the lib. No canDo gate;
// no Supabase session required.
//
// Body: { decision: 'approved'|'rejected'|'changes_requested', comment? }
//
// State machine + finalisation happen atomically in the migration-0072
// Postgres function. See lib/platform/social/approvals/decisions/record.ts
// for the snapshot of guarantees.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/i;

const Schema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  comment: z.string().max(2000).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) {
    return notFound("This approval link is invalid.");
  }

  const rl = await checkRateLimit("approval_decision", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { decision: 'approved'|'rejected'|'changes_requested', comment?: string }.");
  }

  // Best-effort capture of audit fields. Behind a proxy, x-forwarded-
  // for can have a list; we keep the first hop. NEXT_PUBLIC_SITE_URL
  // isn't a useful filter so we keep this loose.
  const xff = req.headers.get("x-forwarded-for");
  const ipAddress =
    xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent");

  const result = await recordApprovalDecision({
    rawToken: token,
    decision: parsed.data.decision,
    comment: parsed.data.comment ?? null,
    ipAddress,
    userAgent,
  });

  if (!result.ok) {
    return respond(result);
  }

  // Notify the submitter + company admins when the decision finalises
  // the request. For all_must partial approvals (finalised=false) we
  // hold notifications until the rule is satisfied — the in-progress
  // state isn't actionable and we'd otherwise spam the submitter on
  // every reviewer's individual approval.
  //
  // Best-effort: lookup + dispatch failures are logged but never
  // propagate back into the response. The decision itself has
  // already been committed and the recipient should see success.
  if (result.data.finalised) {
    try {
      const svc = getServiceRoleClient();

      // V2-first lookup: after backfill, active posts live in social_post_drafts.
      // Fall back to social_post_master for tokens issued before backfill ran.
      let companyId: string | null = null;
      let createdBy: string | null = null;

      const v2 = await svc
        .from("social_post_drafts")
        .select("company_id, created_by")
        .eq("id", result.data.postId)
        .maybeSingle();

      if (v2.data) {
        companyId = v2.data.company_id as string;
        createdBy = v2.data.created_by as string | null;
      } else {
        const v1 = await svc
          .from("social_post_master")
          .select("company_id, created_by")
          .eq("id", result.data.postId)
          .maybeSingle();
        if (v1.error || !v1.data) {
          logger.warn("social.approvals.decisions.notify.post_lookup_failed", {
            err: v1.error?.message,
            post_id: result.data.postId,
          });
        } else {
          companyId = v1.data.company_id as string;
          createdBy = v1.data.created_by as string | null;
        }
      }

      if (companyId && createdBy) {
        if (parsed.data.decision === "changes_requested") {
          await dispatch({
            event: "changes_requested",
            companyId,
            postMasterId: result.data.postId,
            submitterUserId: createdBy,
            comment: parsed.data.comment ?? "",
          });
        } else {
          await dispatch({
            event: "approval_decided",
            companyId,
            postMasterId: result.data.postId,
            submitterUserId: createdBy,
            decision: parsed.data.decision,
          });
        }
      }
    } catch (err) {
      logger.warn("social.approvals.decisions.notify.dispatch_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
