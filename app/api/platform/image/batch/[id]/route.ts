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
// Change 2 (Phase 1 Step 5): for each job's target_platforms, resolve the
// company's connected social_connections rows so the client can display real
// avatar/account names in the PreviewCard instead of stub data.
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for UI display

// Mirrors the mapping in lib/image/auto-attach.ts — duplicated here to avoid
// importing server-only auto-attach logic into this route.
const GENERIC_TO_DB_PLATFORMS: Record<string, string[]> = {
  linkedin:           ["linkedin_company", "linkedin_personal"],
  linkedin_landscape: ["linkedin_company", "linkedin_personal"],
  instagram:          ["instagram_business"],
  instagram_story:    ["instagram_business"],
  facebook:           ["facebook_page"],
  facebook_story:     ["facebook_page"],
  x:                  ["x"],
  gbp:                ["gbp"],
};

interface SocialConnection {
  id: string;
  platform: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * Resolve generic platform codes to the company's connected social_connections.
 * Fail-soft: returns [] on any error (does not block the batch response).
 */
async function resolveConnections(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  genericPlatformCodes: string[],
): Promise<SocialConnection[]> {
  if (genericPlatformCodes.length === 0) return [];

  const dbPlatformsNeeded = new Set<string>();
  for (const code of genericPlatformCodes) {
    for (const dbP of GENERIC_TO_DB_PLATFORMS[code] ?? []) {
      dbPlatformsNeeded.add(dbP);
    }
  }
  if (dbPlatformsNeeded.size === 0) return [];

  const { data, error } = await svc
    .from("social_connections")
    .select("id, platform, display_name, avatar_url")
    .eq("company_id", companyId)
    .in("platform", [...dbPlatformsNeeded])
    .neq("status", "disconnected");

  if (error) {
    logger.warn("image.batch.resolve_connections_failed", { companyId, error: error.message });
    return [];
  }
  return (data ?? []) as SocialConnection[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();

  // Fetch batch — include approval_status + review_round for Phase 1 UI.
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

  const companyId = batch.company_id as string;

  // Sign URLs for completed jobs fresh on read (never stored — §1.6).
  // Also resolve social connections per-job for real avatar display (Change 2).
  const jobsWithData = await Promise.all(
    (jobs ?? []).map(async (job) => {
      let signedUrl: string | null = null;

      if (job.result_storage_path && job.state === "completed") {
        const { data: signed } = await svc.storage
          .from(IMAGE_GEN_BUCKET)
          .createSignedUrl(job.result_storage_path as string, SIGNED_URL_TTL);
        signedUrl = signed?.signedUrl ?? null;
      }

      // Resolve connections for this job's target platforms.
      const targetPlatforms = (job.target_platforms as string[] | null) ?? [];
      const connections = await resolveConnections(svc, companyId, targetPlatforms);

      // Map to client-friendly shape. Order connections to match the job's
      // platform preference order so the first entry is the primary account.
      const resolvedConnections = targetPlatforms.flatMap((code) => {
        const dbPlatforms = GENERIC_TO_DB_PLATFORMS[code] ?? [];
        return dbPlatforms.flatMap((dbP) =>
          connections
            .filter((c) => c.platform === dbP)
            .map((c) => ({
              profileId: c.id,
              platform: c.platform,
              accountName: c.display_name,
              avatarUrl: c.avatar_url,
            })),
        );
      });

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
        resolvedConnections: resolvedConnections.length > 0 ? resolvedConnections : null,
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
      // Change 2: approval workflow fields for Phase 1 UI
      approvalStatus: (batch as Record<string, unknown>).approval_status as string | null ?? null,
      reviewRound: (batch as Record<string, unknown>).review_round as number | null ?? null,
      jobs: jobsWithData,
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
