import { NextResponse, type NextRequest } from "next/server";

import { internalError, notFound, validateUuidParam } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { deleteBatch } from "@/lib/image/batch-ops";

// ---------------------------------------------------------------------------
// GET /api/platform/image/batch/[id]
//
// Returns batch state + all job results. Signed URLs for completed jobs are
// generated fresh on each read (never stored — §1.6).
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for UI display

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();

  // Fetch batch.
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .select("id, company_id, state, total_jobs, completed_jobs, failed_jobs, source_filename, source_row_count, destination, approval_status, review_round, created_at, updated_at")
    .eq("id", idCheck.value)
    .single();

  if (batchErr || !batch) {
    if (batchErr?.code === "PGRST116") return notFound(`Batch ${id} not found.`);
    logger.error("image.batch.fetch_failed", { batchId: id, error: batchErr?.message });
    return internalError("Failed to fetch batch.");
  }

  const gate = await requireCanDoForApi(batch.company_id as string, "create_post");
  if (gate.kind === "deny") return gate.response;

  // Fetch jobs.
  const { data: jobs, error: jobsErr } = await svc
    .from("image_generation_jobs")
    .select("id, state, generation_params, result_storage_path, error_class, error_detail, target_platforms, target_publish_date, parent_post_index, post_text, auto_attach_state, auto_attached_draft_id, started_at, completed_at")
    .eq("batch_id", idCheck.value)
    .order("parent_post_index", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true });

  if (jobsErr) {
    logger.error("image.batch.jobs_fetch_failed", { batchId: id, error: jobsErr.message });
    return internalError("Failed to fetch batch jobs.");
  }

  // Sign URLs for completed jobs fresh on read (never stored — §1.6).
  const jobsWithUrls = await Promise.all(
    (jobs ?? []).map(async (job) => {
      let signedUrl: string | null = null;

      if (job.result_storage_path && job.state === "completed") {
        const { data: signed } = await svc.storage
          .from(IMAGE_GEN_BUCKET)
          .createSignedUrl(job.result_storage_path as string, SIGNED_URL_TTL);
        signedUrl = signed?.signedUrl ?? null;
      }

      return {
        id: job.id,
        state: job.state,
        resultSignedUrl: signedUrl, // null if not completed or signing failed
        errorClass: job.error_class,
        errorDetail: job.error_detail,
        targetPlatforms: job.target_platforms,
        targetPublishDate: job.target_publish_date,
        parentPostIndex: job.parent_post_index,
        postText: job.post_text ?? null,
        autoAttachState: (job.auto_attach_state as string | null) ?? null,
        autoAttachedDraftId: (job.auto_attached_draft_id as string | null) ?? null,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    data: {
      id: batch.id,
      state: batch.state,
      totalJobs: batch.total_jobs,
      completedJobs: batch.completed_jobs,
      failedJobs: batch.failed_jobs,
      sourceFilename: batch.source_filename,
      sourceRowCount: batch.source_row_count,
      destination: (batch.destination as string | null) ?? "publish",
      approvalStatus: (batch.approval_status as string | null) ?? null,
      reviewRound: (batch.review_round as number | null) ?? null,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      jobs: jobsWithUrls,
    },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// DELETE /api/platform/image/batch/[id]
//
// Permanently deletes a batch and all associated jobs, selections, and drafts.
// Auth: canDo("manage_users") — admin only.
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();

  // Fetch batch to get company_id for auth gate and tenant scoping.
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .select("id, company_id")
    .eq("id", idCheck.value)
    .single();

  if (batchErr || !batch) {
    if (batchErr?.code === "PGRST116") return notFound(`Batch ${id} not found.`);
    logger.error("image.batch.delete.fetch_failed", { batchId: id, error: batchErr?.message });
    return internalError("Failed to fetch batch.");
  }

  const gate = await requireCanDoForApi(batch.company_id as string, "manage_users");
  if (gate.kind === "deny") return gate.response;

  await deleteBatch(idCheck.value, batch.company_id as string, gate.userId);

  return NextResponse.json({
    ok: true,
    data: { deleted: true, batchId: id },
    timestamp: new Date().toISOString(),
  });
}
