import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notFound, readJsonBody, respond, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { dispatch } from "@/lib/platform/notifications";
import { recordApprovalDecision } from "@/lib/platform/social/approvals";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";
import { onGatePass, onGateReject } from "@/lib/platform/workflow/image-gate";
import { onProofPass, onProofReject } from "@/lib/platform/proofing";

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
//
// Extended in Phase 1 Step 3 to handle image_batch subject_type:
// - On approved + finalised: calls onGatePass to mark batch approved and
//   update draft workflow_state.
// - On rejected/changes_requested: calls onGateReject with the comment.
//   L17 enforcement: comment is REQUIRED (min 1 char) when decision is
//   'rejected' or 'changes_requested'.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/i;

// L17: comment is required for rejection decisions.
const Schema = z
  .object({
    decision: z.enum(["approved", "rejected", "changes_requested"]),
    comment: z.string().max(2000).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (
      (val.decision === "rejected" || val.decision === "changes_requested") &&
      (!val.comment || val.comment.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "A comment is required when rejecting or requesting changes.",
      });
    }
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
    return validationError(
      "Body must be { decision: 'approved'|'rejected'|'changes_requested', comment?: string }. " +
        "comment is required for rejected/changes_requested decisions.",
    );
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

  // ─── Post-decision side-effects (best-effort, fail-soft) ─────────────────
  //
  // Two branches:
  //   A. image_batch subject_type → call image-gate handlers (onGatePass /
  //      onGateReject) to update batch + draft state.
  //   B. social post (legacy) → notify submitter + admins via dispatch().
  //
  // Both branches run only when the decision has finalised the request.
  // For all_must partial approvals (finalised=false) we hold side-effects
  // until the rule is satisfied.

  if (result.data.finalised) {
    try {
      const svc = getServiceRoleClient();

      // Determine the subject type for this approval request.
      // subject_type column is added by migration 0172; may be null for
      // pre-migration rows (treat as social post).
      const { data: requestRow } = await svc
        .from("social_approval_requests")
        .select("subject_type, subject_id, company_id, created_by")
        .eq("id", result.data.requestId)
        .maybeSingle();

      const subjectType = (requestRow as {
        subject_type: string | null;
        subject_id: string | null;
        company_id: string;
        created_by: string | null;
      } | null)?.subject_type ?? null;

      if (subjectType === "image_batch") {
        // ── Branch A: image_batch gate ─────────────────────────────────────
        const batchId = (requestRow as {
          subject_id: string | null;
        } | null)?.subject_id ?? null;
        const companyId = (requestRow as {
          company_id: string;
        } | null)?.company_id ?? "";
        const actorId = (requestRow as {
          created_by: string | null;
        } | null)?.created_by ?? "";

        if (!batchId) {
          logger.warn("social.approvals.decisions.image_gate.missing_subject_id", {
            requestId: result.data.requestId,
          });
        } else if (parsed.data.decision === "approved") {
          await onGatePass({
            approvalRequestId: result.data.requestId,
            batchId,
            companyId,
            actorId,
            // autoSchedule comes from the gate config; for Phase 1 we always
            // set ready_to_schedule — onGatePass handles both cases the same way.
            autoSchedule: true,
          });
        } else {
          // rejected or changes_requested
          await onGateReject({
            approvalRequestId: result.data.requestId,
            batchId,
            companyId,
            comment: parsed.data.comment ?? "",
            actorId,
          });
        }
      } else if (subjectType === "content_proof") {
        // ── Branch C: content_proof proofing callbacks ─────────────────────
        const contentGroupId = (requestRow as { subject_id: string | null } | null)?.subject_id ?? null;
        const companyId = (requestRow as { company_id: string } | null)?.company_id ?? "";

        if (!contentGroupId) {
          logger.warn("social.approvals.decisions.content_proof.missing_subject_id", {
            requestId: result.data.requestId,
          });
        } else if (parsed.data.decision === "approved") {
          await onProofPass({
            approvalRequestId: result.data.requestId,
            contentGroupId,
            companyId,
            actorUserId: (requestRow as { created_by: string | null } | null)?.created_by ?? null,
            origin: req.nextUrl.origin,
          });
        } else {
          // rejected or changes_requested
          await onProofReject({
            approvalRequestId: result.data.requestId,
            contentGroupId,
            companyId,
            comment: parsed.data.comment ?? null,
          });
        }
      } else {
        // ── Branch B: social post notification (original behaviour) ───────
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
      }
    } catch (err) {
      logger.warn("social.approvals.decisions.post_decision_failed", {
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
