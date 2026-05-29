import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, routeError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { verifyQstashSignature } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";
import { generateWithFallback } from "@/lib/image";
import type { GenerationParams, AspectRatio } from "@/lib/image/types";
import { compositeImage, TEXT_ZONE_MAP } from "@/lib/image/compositing";
import { getTemplateV1 } from "@/lib/image/compositing/templates-v1";
import { enqueueImageJob } from "@/lib/image/enqueue";
import {
  acquireImageLease,
  releaseImageLease,
  getActiveLeaseCount,
  getConcurrencyCap,
} from "@/lib/image/lease";
import { incrementImageGenSpend } from "@/lib/image/budget";
import { notifyImageGenBudgetThreshold } from "@/lib/image/budget-notify";
import { generatePreview } from "@/lib/image/generator/preview";

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
  // CAP pipeline fields (optional — only present for CAP-triggered jobs)
  capDraftId: z.string().uuid().optional(),
  headlineText: z.string().max(200).optional(),
  logoUrl: z.string().url().optional(),
  // B5: when true, build the prompt and return without calling Ideogram.
  previewOnly: z.boolean().optional(),
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

  const { jobId, generationParams, batchId, capDraftId, headlineText, logoUrl, previewOnly } = parsed;

  logger.info("image.qstash.received", {
    jobId,
    batchId,
    companyId: generationParams.companyId,
    previewOnly: previewOnly === true,
  });

  // ─── B5: preview-only short-circuit ─────────────────────────────────────
  // Bypass lease + concurrency + Ideogram. Build the prompt, write the audit
  // row, mark the job completed with null result. Never increments spend.
  // Preview never enters the concurrency budget — it's a synchronous read
  // from prompt-engine and has no cost to throttle.
  if (previewOnly) {
    return handlePreview({ jobId, generationParams, batchId });
  }

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
        capDraftId: parsed.capDraftId,
        headlineText: parsed.headlineText,
        logoUrl: parsed.logoUrl,
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

  // ─── 4. Generate + composite ─────────────────────────────────────────────

  try {
    const images = await generateWithFallback({
      ...generationParams,
      count: 1, // single image per job
    });

    const image = images[0];
    if (!image) {
      throw new Error("generateWithFallback returned empty array");
    }

    // Composite if we have a headline (indicates CAP or batch pipeline with
    // templates-v1.ts code templates per §1.8 of the addendum).
    let finalStoragePath = image.storagePath;
    if (headlineText) {
      try {
        const template = getTemplateV1(generationParams.aspectRatio as AspectRatio);
        const textZone = TEXT_ZONE_MAP[generationParams.compositionType];
        const composite = await compositeImage({
          backgroundStoragePath: image.storagePath,
          textZones: [{
            ...textZone,
            text: headlineText,
            maxFontSize: template.maxHeadlineFontSize,
            colour: "white",
          }],
          logo: logoUrl ? {
            url: logoUrl,
            position: template.logoPosition,
            sizePercent: template.logoSizePercent,
            padding: template.logoPadding,
          } : null,
          outputFormat: image.format === "png" ? "png" : "jpeg",
          outputWidth: image.width,
          outputHeight: image.height,
        });
        finalStoragePath = composite.storagePath;
      } catch (compErr) {
        // Compositing failure is non-fatal — use raw background
        logger.warn("image.qstash.composite_failed", {
          jobId,
          err: compErr instanceof Error ? compErr.message : String(compErr),
        });
      }
    }

    await svc.from("image_generation_jobs").update({
      state: "completed",
      result_storage_path: finalStoragePath, // storage path only — never a signed URL (§1.6)
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    // B3: increment per-company spend (non-blocking). Success only — never on
    // failure, never on preview. The handler never sees preview jobs (the batch
    // route skips QStash enqueue in preview mode).
    void recordBudgetSpend(generationParams.companyId);

    // Update batch state after job completion (non-blocking).
    if (batchId) void updateBatchProgress(svc, batchId);

    // CAP pipeline: link the composited image to the draft (non-blocking).
    if (capDraftId) void linkCapDraft(svc, capDraftId, generationParams.companyId, finalStoragePath, image.format);

    logger.info("image.qstash.completed", { jobId, storagePath: finalStoragePath, composited: finalStoragePath !== image.storagePath });
    return NextResponse.json({ ok: true, status: "completed", storagePath: finalStoragePath });

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

/**
 * After a CAP job completes: persist the composited image as a
 * social_media_assets row and link it to the draft via media_urls.
 * Non-blocking — called via void; errors logged, never thrown.
 */
async function linkCapDraft(
  svc: ReturnType<typeof import("@/lib/supabase").getServiceRoleClient>,
  draftId: string,
  companyId: string,
  storagePath: string,
  format: string,
): Promise<void> {
  const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
  const SIGNED_URL_TTL = 365 * 24 * 3600; // 1 year

  try {
    // Sign a long-lived URL for source_url (legacy pattern — see §1.6 for new jobs).
    const { data: signed } = await svc.storage
      .from(IMAGE_GEN_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL);

    if (!signed?.signedUrl) {
      logger.warn("cap.image.signed_url_failed", { draftId, storagePath });
      return;
    }

    const { data: asset } = await svc
      .from("social_media_assets")
      .insert({
        company_id: companyId,
        storage_path: storagePath,
        mime_type: `image/${format === "png" ? "png" : "jpeg"}`,
        bytes: 0, // size unknown at this point; acceptable
        source_url: signed.signedUrl,
      })
      .select("id")
      .single();

    if (!asset?.id) {
      logger.warn("cap.image.asset_insert_failed", { draftId });
      return;
    }

    await svc
      .from("social_post_drafts")
      .update({ media_urls: [signed.signedUrl] })
      .eq("id", draftId);

    logger.info("cap.image.draft_linked", { draftId, companyId, assetId: asset.id });
  } catch (err) {
    logger.warn("cap.image.link_failed", {
      draftId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * B5: handle a preview-only delivery. Build the prompt via prompt-engine,
 * persist it to the job + image_generation_log, and return 200. Never calls
 * Ideogram. Never increments spend. Never holds a lease.
 */
async function handlePreview(input: {
  jobId: string;
  generationParams: z.infer<typeof GenerationParamsSchema>;
  batchId: string | undefined;
}): Promise<NextResponse> {
  const svc = getServiceRoleClient();

  let prompt: string;
  try {
    const result = generatePreview(input.generationParams);
    prompt = result.prompt;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn("image.qstash.preview_prompt_failed", { jobId: input.jobId, err: detail });
    await svc
      .from("image_generation_jobs")
      .update({
        state: "failed",
        error_class: "PreviewPromptError",
        error_detail: detail.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.jobId);
    if (input.batchId) void updateBatchProgress(svc, input.batchId);
    return NextResponse.json({ ok: false, status: "preview_failed", error: detail });
  }

  // Stash prompt into generation_params so the UI can show it without a new column.
  const enrichedParams = { ...input.generationParams, preview_prompt: prompt };

  await svc
    .from("image_generation_jobs")
    .update({
      state: "completed",
      result_storage_path: null,
      generation_params: enrichedParams,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.jobId);

  // Audit row — outcome='preview' per §B5. Never block on this; warn on failure.
  await svc
    .from("image_generation_log")
    .insert({
      company_id: input.generationParams.companyId,
      style_id: input.generationParams.styleId,
      composition_type: input.generationParams.compositionType,
      aspect_ratio: input.generationParams.aspectRatio,
      model_used: "preview",
      model_tier: input.generationParams.model ?? "standard",
      prompt_used: prompt,
      outcome: "preview",
    })
    .then(({ error }) => {
      if (error) {
        logger.warn("image.qstash.preview_log_insert_failed", {
          jobId: input.jobId,
          err: error.message,
        });
      }
    });

  if (input.batchId) void updateBatchProgress(svc, input.batchId);

  logger.info("image.qstash.preview_completed", {
    jobId: input.jobId,
    promptLength: prompt.length,
  });
  return NextResponse.json({ ok: true, status: "preview", prompt });
}

/**
 * B3: bump the company's monthly image-gen spend, and if this is the first
 * time we crossed the 80% threshold for the month, send the operator email.
 * Non-blocking — called via void; errors logged, never thrown.
 */
async function recordBudgetSpend(companyId: string): Promise<void> {
  try {
    const result = await incrementImageGenSpend(companyId, 1);
    if (!result) return;
    if (result.crossed_80_percent) {
      // Look up the company name for a friendlier email subject.
      const svc = getServiceRoleClient();
      const { data: company } = await svc
        .from("platform_companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      const companyName = (company as { name: string } | null)?.name;
      await notifyImageGenBudgetThreshold({
        companyId,
        companyName,
        spentCents: result.spent_cents,
        budgetCents: result.budget_cents,
      });
    }
  } catch (err) {
    logger.warn("image.budget.spend_record_failed", {
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
