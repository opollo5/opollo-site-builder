import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { enqueueImageJob } from "@/lib/image/enqueue";
import { checkImageGenBudget } from "@/lib/image/budget";
import type { GenerationParams } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// Image-batch dispatch helper. Owns the per-batch DB + QStash side effects
// shared between:
//   - the platform batch endpoint (app/api/platform/image/batch/route.ts),
//     which carries its own auth gate and is the operator-facing entrypoint
//   - the platform ingest endpoint (app/api/platform/image/ingest/route.ts),
//     which runs C1/C2 parser → C3 interpreter → THIS function in one POST
//
// Both callers gate auth before invoking this. The function itself runs
// service-role writes.
// ---------------------------------------------------------------------------

export type BatchMode = "generate" | "preview";

export interface DispatchJobSpec {
  styleId: GenerationParams["styleId"];
  primaryColour: string;
  compositionType: GenerationParams["compositionType"];
  aspectRatio: GenerationParams["aspectRatio"];
  industry?: string;
  targetPlatforms?: string[];
  targetPublishDate?: string;
  parentPostIndex?: number;
}

export interface DispatchInput {
  companyId: string;
  triggeredBy: string;
  jobs: DispatchJobSpec[];
  mode: BatchMode;
  sourceFilename?: string;
  sourceRowCount?: number;
}

export type DispatchResult =
  | {
      ok: true;
      batchId: string;
      totalJobs: number;
      mode: BatchMode;
      enqueueErrors?: string[];
    }
  | {
      ok: false;
      code: "BUDGET_EXCEEDED" | "BATCH_CREATE_FAILED";
      message: string;
      details?: {
        projected_jobs?: number;
        projected_cents?: number;
        source_row_count?: number | null;
        remaining_cents?: number;
        budget_cents?: number;
        spent_cents?: number;
        next_reset_at?: string;
      };
    };

export async function dispatchImageBatch(input: DispatchInput): Promise<DispatchResult> {
  const svc = getServiceRoleClient();
  const { companyId, triggeredBy, jobs, mode } = input;

  if (mode !== "preview") {
    const budget = await checkImageGenBudget(companyId, jobs.length);
    if (!budget.allowed) {
      logger.info("image.dispatch.budget_rejected", {
        companyId,
        projectedJobs: budget.projected_jobs,
        projectedCents: budget.projected_cents,
        remainingCents: budget.remaining_cents,
        reason: budget.reason,
      });
      return {
        ok: false,
        code: "BUDGET_EXCEEDED",
        message: `Projected ${budget.projected_jobs} images cost $${(budget.projected_cents / 100).toFixed(2)}; $${(budget.remaining_cents / 100).toFixed(2)} remaining this month.`,
        details: {
          projected_jobs: budget.projected_jobs,
          projected_cents: budget.projected_cents,
          source_row_count: input.sourceRowCount ?? null,
          remaining_cents: budget.remaining_cents,
          budget_cents: budget.budget_cents,
          spent_cents: budget.spent_cents,
          next_reset_at: budget.next_reset_at,
        },
      };
    }
  }

  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .insert({
      company_id: companyId,
      state: "pending",
      total_jobs: jobs.length,
      source_filename: input.sourceFilename ?? null,
      source_row_count: input.sourceRowCount ?? null,
      triggered_by: triggeredBy,
    })
    .select("id")
    .single();

  if (batchErr || !batch) {
    logger.error("image.dispatch.batch_create_failed", { companyId, error: batchErr?.message });
    return {
      ok: false,
      code: "BATCH_CREATE_FAILED",
      message: batchErr?.message ?? "Failed to create batch.",
    };
  }

  const batchId = (batch as { id: string }).id;
  const jobErrors: string[] = [];
  const jobIds: string[] = [];

  for (const spec of jobs) {
    const generationParams: GenerationParams = {
      styleId: spec.styleId,
      primaryColour: spec.primaryColour,
      compositionType: spec.compositionType,
      aspectRatio: spec.aspectRatio,
      industry: spec.industry,
      companyId,
      count: 1,
    };

    const { data: job, error: jobErr } = await svc
      .from("image_generation_jobs")
      .insert({
        company_id: companyId,
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
      logger.error("image.dispatch.job_create_failed", { batchId, error: jobErr?.message });
      jobErrors.push(`Failed to create job: ${jobErr?.message ?? "unknown"}`);
      continue;
    }

    const jobId = (job as { id: string }).id;
    jobIds.push(jobId);

    const enqueue = await enqueueImageJob({
      jobId,
      generationParams,
      batchId,
      ...(mode === "preview" && { previewOnly: true }),
    });
    if (!enqueue.ok) {
      logger.error("image.dispatch.enqueue_failed", { batchId, jobId, error: enqueue.error });
      await svc
        .from("image_generation_jobs")
        .update({ state: "failed", error_class: "EnqueueFailed", error_detail: enqueue.error })
        .eq("id", jobId);
      jobErrors.push(`Job ${jobId} failed to enqueue: ${enqueue.error}`);
    }
  }

  const allFailed = jobErrors.length === jobs.length;
  await svc
    .from("image_generation_batches")
    .update({
      state: allFailed ? "failed" : "running",
      failed_jobs: jobErrors.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  logger.info("image.dispatch.created", {
    batchId,
    companyId,
    totalJobs: jobs.length,
    enqueuedJobs: jobIds.length - jobErrors.length,
    mode,
  });

  return {
    ok: true,
    batchId,
    totalJobs: jobs.length,
    mode,
    ...(jobErrors.length > 0 && { enqueueErrors: jobErrors }),
  };
}
