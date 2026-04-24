import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/batch/[id]/cancel — M3-8.
//
// Cancels a queued-or-running batch job. Semantics:
//
//   1. Set cancel_requested_at = now() + status = 'cancelled' + finish
//      stamps on the job, immediately.
//
//   2. Mark every pending slot as 'skipped' so the worker never picks
//      them up.
//
//   3. In-flight slots (leased / generating / validating / publishing)
//      are left to complete. The worker's job-aggregation UPDATE
//      preserves 'cancelled' status via a top-branch CASE so their
//      eventual success / failure doesn't flip the status back.
//
// Idempotent: re-cancelling an already-cancelled job returns 200 with
// { changed: false }.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const jobId = params.id;
  if (!UUID_RE.test(jobId)) {
    return errorJson("VALIDATION_FAILED", "Job id must be a UUID.", 400);
  }

  const svc = getServiceRoleClient();

  const { data: existing, error: readErr } = await svc
    .from("generation_jobs")
    .select("id, status, cancel_requested_at, created_by")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) {
    logger.error("admin.batch.cancel.read_failed", { job_id: jobId, error: readErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to read job. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }
  if (!existing) {
    return errorJson("NOT_FOUND", "No job with that id.", 404);
  }

  // Operators can only cancel their own jobs; admins can cancel any.
  if (
    gate.user &&
    gate.user.role !== "admin" &&
    existing.created_by !== gate.user.id
  ) {
    return errorJson(
      "FORBIDDEN",
      "Operators can only cancel batches they created.",
      403,
    );
  }

  if (existing.status === "cancelled") {
    return NextResponse.json(
      {
        ok: true,
        data: { id: jobId, status: "cancelled", changed: false },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  if (
    existing.status !== "queued" &&
    existing.status !== "running" &&
    existing.status !== "partial"
  ) {
    // Terminal statuses (succeeded, failed) can't be cancelled — the
    // batch is already done.
    return errorJson(
      "INVALID_STATE",
      `Job in status '${existing.status}' cannot be cancelled.`,
      409,
    );
  }

  // Flip job status + set cancel_requested_at. No ELSE — we just
  // overwrite whatever status we read, since the guard above limited
  // the set to {queued, running, partial}.
  const now = new Date().toISOString();
  const { error: jobErr } = await svc
    .from("generation_jobs")
    .update({
      status: "cancelled",
      cancel_requested_at: now,
      finished_at: now,
      updated_at: now,
    })
    .eq("id", jobId);
  if (jobErr) {
    logger.error("admin.batch.cancel.update_failed", { job_id: jobId, error: jobErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to cancel job. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  // Mark every pending slot as skipped so the lease-next query never
  // touches them. In-flight slots finish under the worker's own
  // control; the worker's aggregation UPDATE preserves the
  // 'cancelled' status.
  const { error: slotsErr } = await svc
    .from("generation_job_pages")
    .update({
      state: "skipped",
      last_error_code: "CANCELLED",
      last_error_message: "Batch was cancelled.",
      finished_at: now,
      updated_at: now,
      retry_after: null,
    })
    .eq("job_id", jobId)
    .eq("state", "pending");
  if (slotsErr) {
    logger.error("admin.batch.cancel.slots_failed", { job_id: jobId, error: slotsErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to mark pending slots skipped. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  await svc.from("generation_events").insert({
    job_id: jobId,
    event: "batch_cancelled",
    details: {
      cancelled_by: gate.user?.id ?? null,
      prior_status: existing.status,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      data: { id: jobId, status: "cancelled", changed: true },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
