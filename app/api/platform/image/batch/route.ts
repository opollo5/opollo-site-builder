import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { enqueueImageJob } from "@/lib/image/enqueue";
import { checkImageGenBudget } from "@/lib/image/budget";
import type { GenerationParams } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// POST /api/platform/image/batch
//
// Creates a batch + N image_generation_jobs, enqueues one QStash message per
// job, returns the batchId for the operator to poll.
//
// B3: a per-company monthly budget cap is enforced before creating the batch.
// Preview mode (mode='preview') skips the budget check — preview never calls
// Ideogram and never increments spend.
//
// §1.2: route under /api/platform/image/*, not /social/
// §1.7: one job per distinct aspect ratio derived from target_platforms.
// §1.6: no signed URLs stored; result_storage_path set by the handler.
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JobSpecSchema = z.object({
  styleId: z.enum(["clean_corporate", "bold_promo", "minimal_modern", "editorial", "product_focus"]),
  primaryColour: z.string(),
  compositionType: z.enum(["split_layout", "gradient_fade", "full_background", "geometric", "texture"]),
  aspectRatio: z.enum(["1x1", "4x5", "9x16", "16x9", "4x3"]),
  industry: z.string().optional(),
  targetPlatforms: z.array(z.string()).optional(),
  targetPublishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  parentPostIndex: z.number().int().min(0).optional(),
});

const BatchSchema = z.object({
  company_id: dbUuid(),
  jobs: z.array(JobSpecSchema).min(1).max(100),
  source_filename: z.string().optional(),
  source_row_count: z.number().int().min(1).optional(),
  mode: z.enum(["generate", "preview"]).default("generate"),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid batch spec.", { issues: parsed.error.issues });
  }

  const { company_id, jobs, source_filename, source_row_count, mode } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  // ─── B3: budget pre-flight ───────────────────────────────────────────────
  // Preview mode never spends real Ideogram credits (per B5), so skip.
  // Per §1.7: projected job count is the number of jobs being enqueued, not
  // the source row count. The caller (C4 ingestion route) deduplicates
  // aspect ratios per row before constructing the jobs array.
  if (mode !== "preview") {
    const budget = await checkImageGenBudget(company_id, jobs.length);
    if (!budget.allowed) {
      logger.info("image.batch.budget_rejected", {
        companyId: company_id,
        projectedJobs: budget.projected_jobs,
        projectedCents: budget.projected_cents,
        remainingCents: budget.remaining_cents,
        reason: budget.reason,
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "BUDGET_EXCEEDED",
            message: `Projected ${budget.projected_jobs} images cost $${(budget.projected_cents / 100).toFixed(2)}; $${(budget.remaining_cents / 100).toFixed(2)} remaining this month.`,
            projected_jobs: budget.projected_jobs,
            projected_cents: budget.projected_cents,
            source_row_count: source_row_count ?? null,
            remaining_cents: budget.remaining_cents,
            budget_cents: budget.budget_cents,
            spent_cents: budget.spent_cents,
            next_reset_at: budget.next_reset_at,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
  }

  // Create the batch row.
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .insert({
      company_id,
      state: "pending",
      total_jobs: jobs.length,
      source_filename: source_filename ?? null,
      source_row_count: source_row_count ?? null,
      triggered_by: gate.userId,
    })
    .select("id")
    .single();

  if (batchErr || !batch) {
    logger.error("image.batch.create_failed", { companyId: company_id, error: batchErr?.message });
    return internalError("Failed to create batch.");
  }

  const batchId = batch.id as string;

  // Create job rows + enqueue to QStash.
  const jobErrors: string[] = [];
  const jobIds: string[] = [];

  for (const spec of jobs) {
    const generationParams: GenerationParams = {
      styleId: spec.styleId,
      primaryColour: spec.primaryColour,
      compositionType: spec.compositionType,
      aspectRatio: spec.aspectRatio,
      industry: spec.industry,
      companyId: company_id,
      count: 1,
    };

    // Create job row.
    const { data: job, error: jobErr } = await svc
      .from("image_generation_jobs")
      .insert({
        company_id,
        batch_id: batchId,
        state: "pending",
        generation_params: generationParams,
        target_platforms: spec.targetPlatforms ?? null,
        target_publish_date: spec.targetPublishDate ?? null,
        parent_post_index: spec.parentPostIndex ?? null,
      })
      .select("id")
      .single();

    if (jobErr || !job) {
      logger.error("image.batch.job_create_failed", { batchId, error: jobErr?.message });
      jobErrors.push(`Failed to create job: ${jobErr?.message ?? "unknown"}`);
      continue;
    }

    const jobId = job.id as string;
    jobIds.push(jobId);

    // Preview mode: skip QStash; job state stays 'pending' as a draft marker.
    if (mode === "preview") continue;

    // Enqueue to QStash.
    const enqueue = await enqueueImageJob({ jobId, generationParams, batchId });
    if (!enqueue.ok) {
      logger.error("image.batch.enqueue_failed", { batchId, jobId, error: enqueue.error });
      // Mark job failed immediately so the batch tracker has accurate counts.
      await svc
        .from("image_generation_jobs")
        .update({ state: "failed", error_class: "EnqueueFailed", error_detail: enqueue.error })
        .eq("id", jobId);
      jobErrors.push(`Job ${jobId} failed to enqueue: ${enqueue.error}`);
    }
  }

  // Advance batch to running (or failed if everything errored).
  const allFailed = jobErrors.length === jobs.length;
  await svc
    .from("image_generation_batches")
    .update({
      state: mode === "preview" ? "pending" : allFailed ? "failed" : "running",
      failed_jobs: jobErrors.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  logger.info("image.batch.created", {
    batchId,
    companyId: company_id,
    totalJobs: jobs.length,
    enqueuedJobs: jobIds.length - jobErrors.length,
    mode,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        batchId,
        totalJobs: jobs.length,
        mode,
        ...(jobErrors.length > 0 && { enqueueErrors: jobErrors }),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
