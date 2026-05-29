import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, routeError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { verifyQstashSignature } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";
import { generateWithFallback } from "@/lib/image";
import type { GenerationParams } from "@/lib/image/types";
import { enqueueImageJob } from "@/lib/image/enqueue";
import {
  acquireImageLease,
  releaseImageLease,
  getActiveLeaseCount,
  getConcurrencyCap,
} from "@/lib/image/lease";

// ---------------------------------------------------------------------------
// POST /api/internal/image/qstash-handler
//
// QStash callback: generates one image via the canonical pipeline and
// persists the result to image_generation_jobs.
//
// Auth: Upstash-Signature header verified via verifyQstashSignature().
//
// Response policy (governs QStash retry behaviour):
//   200 ok/duplicate/requeued — stops QStash retries
//   400 VALIDATION_FAILED      — bad body; QStash treats as permanent failure
//   401 INVALID_SIGNATURE       — bad/missing signature
//   503 RECEIVER_NOT_CONFIGURED — signing key unset (dev/test)
//   500 INTERNAL_ERROR          — retryable DB / generation error
//
// Concurrency: Redis lease per jobId (TTL 90s, SET NX EX 90).
//   Duplicate delivery → 200 idempotent no-op (NX returns nil).
//   Active leases ≥ cap → re-enqueue with 30s delay, return 200.
//
// See docs/briefs/image-generator/MASS_IMAGE_GEN_BUILD_BRIEF.md §B1.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90; // matches lease TTL; Ideogram ~11s + Bannerbear ~30s

const GenerationParamsSchema = z.object({
  styleId: z.enum(["clean_corporate", "bold_promo", "minimal_modern", "editorial", "product_focus"]),
  primaryColour: z.string(),
  compositionType: z.enum(["split_layout", "gradient_fade", "full_background", "geometric", "texture"]),
  aspectRatio: z.enum(["1x1", "4x5", "9x16", "16x9", "4x3"]),
  model: z.enum(["standard", "premium"]).optional(),
  count: z.number().int().min(1).max(6).optional(),
  industry: z.string().optional(),
  mood: z.string().optional(),
  companyId: z.string().uuid(),
  brandProfileId: z.string().uuid().optional(),
  brandProfileVersion: z.number().int().optional(),
  postMasterId: z.string().uuid().optional(),
  triggeredBy: z.string().optional(),
  simplifyPrompt: z.boolean().optional(),
}) satisfies z.ZodType<GenerationParams>;

const BodySchema = z.object({
  jobId: z.string().uuid(),
  generationParams: GenerationParamsSchema,
  batchId: z.string().uuid().optional(),
});

type Body = z.infer<typeof BodySchema>;

const REQUEUE_DELAY_SECONDS = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // Signature verification IS the auth for this route.
  const verify = await verifyQstashSignature({
    signature: req.headers.get("upstash-signature"),
    rawBody,
  });
  if (!verify.ok) {
    logger.warn("image.qstash.unauthorized", { reason: verify.reason });
    if (verify.reason === "no_receiver") {
      return routeError("RECEIVER_NOT_CONFIGURED", "QSTASH_CURRENT_SIGNING_KEY is not configured.");
    }
    return routeError("INVALID_SIGNATURE", "Invalid or missing Upstash-Signature.");
  }

  let parsed: Body;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return validationError(`Invalid body: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { jobId, generationParams, batchId } = parsed;

  logger.info("image.qstash.received", { jobId, batchId, companyId: generationParams.companyId });

  // ─── 1. Acquire Redis lease (dedup + concurrency token) ───────────────────

  const leaseResult = await acquireImageLease(jobId);

  if (!leaseResult.ok) {
    if (leaseResult.reason === "duplicate") {
      // Second delivery for an already-in-flight job. Absorb silently.
      logger.info("image.qstash.duplicate", { jobId });
      return NextResponse.json({ ok: true, status: "duplicate" });
    }
    // Redis unconfigured — proceed without lease enforcement (degrade gracefully).
    logger.warn("image.qstash.no_redis_lease", { jobId });
  }

  // ─── 2. Concurrency cap check ──────────────────────────────────────────────

  if (leaseResult.ok) {
    const activeCount = await getActiveLeaseCount();
    const cap = getConcurrencyCap();

    if (activeCount > cap) {
      // At or above cap. Release our lease and re-enqueue with delay.
      await releaseImageLease(jobId);
      logger.info("image.qstash.at_cap", { jobId, activeCount, cap });

      const requeue = await enqueueImageJob({
        jobId,
        generationParams,
        batchId,
        delaySeconds: REQUEUE_DELAY_SECONDS,
      });

      if (!requeue.ok) {
        logger.error("image.qstash.requeue_failed", { jobId, error: requeue.error });
        // Return 500 so QStash retries; it will back-off and retry the original delivery.
        return internalError("Failed to re-enqueue job at concurrency cap.");
      }

      return NextResponse.json({ ok: true, status: "requeued", delaySeconds: REQUEUE_DELAY_SECONDS });
    }
  }

  // ─── 3. Mark job running ───────────────────────────────────────────────────

  const svc = getServiceRoleClient();
  const { error: markRunningErr } = await svc
    .from("image_generation_jobs")
    .update({ state: "running", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("state", "pending"); // atomic: only advance from pending

  if (markRunningErr) {
    await releaseImageLease(jobId);
    logger.error("image.qstash.mark_running_failed", { jobId, error: markRunningErr.message });
    return internalError("Failed to claim job.");
  }

  // If 0 rows updated the job was already running/completed (race or re-delivery after DB write).
  const { count } = await svc
    .from("image_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("id", jobId)
    .eq("state", "running");

  if (!count) {
    // Job is not in running state — it was already processed by another delivery.
    await releaseImageLease(jobId);
    logger.info("image.qstash.already_processed", { jobId });
    return NextResponse.json({ ok: true, status: "already_processed" });
  }

  // ─── 4. Generate ─────────────────────────────────────────────────────────

  try {
    const images = await generateWithFallback({
      ...generationParams,
      count: 1, // single image per job
    });

    const image = images[0];
    if (!image) {
      throw new Error("generateWithFallback returned empty array");
    }

    await svc.from("image_generation_jobs").update({
      state: "completed",
      result_storage_path: image.storagePath, // storage path only — never a signed URL (§1.6)
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    // Update batch state after job completion (non-blocking).
    if (batchId) void updateBatchProgress(svc, batchId);

    logger.info("image.qstash.completed", { jobId, storagePath: image.storagePath });
    return NextResponse.json({ ok: true, status: "completed", storagePath: image.storagePath });

  } catch (err) {
    const errorClass = err instanceof Error ? err.constructor.name : "UnknownError";
    const errorDetail = err instanceof Error ? err.message : String(err);

    // Distinguish escalated (all retries exhausted) from plain failed.
    const state = errorClass === "ImageGenerationError" ? "escalated" : "failed";

    await svc.from("image_generation_jobs").update({
      state,
      error_class: errorClass,
      error_detail: errorDetail.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    // Update batch state after job failure (non-blocking).
    if (batchId) void updateBatchProgress(svc, batchId);

    logger.error("image.qstash.generation_failed", { jobId, state, errorClass, errorDetail });

    // Return 200 — generation failure is permanent; QStash retrying won't help
    // (the pipeline already retried internally via generateWithFallback).
    return NextResponse.json({ ok: false, status: state, error: errorDetail });

  } finally {
    // Always release the lease — runs even when generation throws.
    await releaseImageLease(jobId);
  }
}

/**
 * Recalculate batch progress from live job counts and update batch state.
 * Non-blocking — called via void; errors are logged, never thrown.
 */
async function updateBatchProgress(
  svc: ReturnType<typeof import("@/lib/supabase").getServiceRoleClient>,
  batchId: string,
): Promise<void> {
  try {
    const { data: counts } = await svc
      .from("image_generation_jobs")
      .select("state")
      .eq("batch_id", batchId);

    if (!counts) return;

    const total = counts.length;
    const completed = counts.filter((j) => j.state === "completed").length;
    const failed = counts.filter((j) => j.state === "failed" || j.state === "escalated").length;
    const pending = counts.filter((j) => j.state === "pending" || j.state === "running").length;

    let state: string;
    if (pending > 0) {
      state = "running";
    } else if (failed === total) {
      state = "failed";
    } else if (failed > 0) {
      state = "partial";
    } else {
      state = "completed";
    }

    await svc
      .from("image_generation_batches")
      .update({ state, completed_jobs: completed, failed_jobs: failed, updated_at: new Date().toISOString() })
      .eq("id", batchId);
  } catch (err) {
    logger.warn("image.batch.progress_update_failed", {
      batchId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
