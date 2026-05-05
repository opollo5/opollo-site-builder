import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { retryPublishAttempt } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-20 — POST /api/platform/social/publish-attempts/[id]/retry
//
// Operator-triggered retry for a failed publish_attempt. Body carries
// company_id (used by the canDo gate); the attempt's own company is
// resolved server-side from publish_jobs.company_id and must match.
//
// Gate: canDo("schedule_post", company_id) (approver+).
//
// Response: { outcome, newAttemptId?, bundlePostId? } — same shape
// as fire.ts. 200 on every successful outcome (including no-op
// already_retrying / connection_degraded / publish_failed); 4xx on
// auth/validation; 500 only on RPC unreachability.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: status >= 500 },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid }.",
      400,
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  // Cross-company isolation: confirm the attempt's job belongs to the
  // company the operator's session is scoped to. NOT_FOUND envelope on
  // mismatch (don't leak existence).
  const svc = getServiceRoleClient();
  const attempt = await svc
    .from("social_publish_attempts")
    .select("publish_job_id")
    .eq("id", id)
    .maybeSingle();
  if (attempt.error || !attempt.data) {
    return errorJson("NOT_FOUND", "Attempt not found.", 404);
  }
  const job = await svc
    .from("social_publish_jobs")
    .select("company_id")
    .eq("id", attempt.data.publish_job_id as string)
    .maybeSingle();
  if (
    job.error ||
    !job.data ||
    (job.data.company_id as string) !== parsed.data.company_id
  ) {
    return errorJson("NOT_FOUND", "Attempt not found.", 404);
  }

  const result = await retryPublishAttempt({ attemptId: id });
  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") {
      return errorJson("VALIDATION_FAILED", result.error.message, 400);
    }
    return errorJson("INTERNAL_ERROR", result.error.message, 500);
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
