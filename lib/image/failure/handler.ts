import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { dispatch } from "@/lib/platform/notifications/dispatch";

import type { GeneratedImage, GenerationParams, ImageGenOutcome } from "../types";
import { IdeogramError, ImageGenerationError } from "../types";
import { generateBackground, isRetryable } from "../generator/ideogram";
import { thirdAttemptFallback } from "../generator/stock";
import { qualityCheck } from "./quality-check";

// The entry point for all image generation. All product code calls this —
// never generateBackground() directly.
export async function generateWithFallback(
  params: GenerationParams,
): Promise<GeneratedImage[]> {
  const logBase = {
    companyId: params.companyId,
    styleId: params.styleId,
    compositionType: params.compositionType,
  };

  // Attempt 1
  try {
    const images = await generateBackground(params);
    const checks = await Promise.all(
      images.map((img) =>
        img.buffer
          ? qualityCheck(img.buffer, params.compositionType)
          : Promise.resolve({ passed: true, luminanceScore: 128, safeZoneScore: 0 }),
      ),
    );
    const passed = images.filter((_, i) => checks[i].passed);

    if (passed.length > 0) {
      await writeImageLog({
        ...logBase,
        brandProfileId: params.brandProfileId,
        brandProfileVersion: params.brandProfileVersion,
        aspectRatio: params.aspectRatio,
        postMasterId: params.postMasterId,
        triggeredBy: params.triggeredBy,
        outcome: "success",
        retryCount: 0,
        backgroundStoragePath: passed[0].storagePath,
        qualityCheck: checks[0],
      });
      return passed;
    }

    logger.warn("Quality check failed on attempt 1", logBase);
  } catch (err) {
    if (err instanceof IdeogramError && !isRetryable(err)) {
      logger.warn("Non-retryable Ideogram error on attempt 1", {
        ...logBase,
        status: err.status,
      });
      return regenerateThenEscalate(params, logBase);
    }
    logger.warn("Retryable error on attempt 1", {
      ...logBase,
      error: String(err),
    });
  }

  // Attempt 2 — simplified prompt
  try {
    const images = await generateBackground({ ...params, simplifyPrompt: true });
    const checks = await Promise.all(
      images.map((img) =>
        img.buffer
          ? qualityCheck(img.buffer, params.compositionType)
          : Promise.resolve({ passed: true, luminanceScore: 128, safeZoneScore: 0 }),
      ),
    );
    const passed = images.filter((_, i) => checks[i].passed);

    if (passed.length > 0) {
      await writeImageLog({
        ...logBase,
        brandProfileId: params.brandProfileId,
        brandProfileVersion: params.brandProfileVersion,
        aspectRatio: params.aspectRatio,
        postMasterId: params.postMasterId,
        triggeredBy: params.triggeredBy,
        outcome: "retry_success",
        retryCount: 1,
        backgroundStoragePath: passed[0].storagePath,
        qualityCheck: checks[0],
      });
      return passed;
    }
  } catch {
    logger.warn("Attempt 2 failed", logBase);
  }

  return regenerateThenEscalate(params, logBase);
}

/**
 * Attempt 3: different style + maximum simplification.
 * If that also fails, escalate to human via email.
 */
async function regenerateThenEscalate(
  params: GenerationParams,
  logBase: { companyId: string; styleId: string; compositionType: string },
): Promise<GeneratedImage[]> {
  try {
    const images = await thirdAttemptFallback(params);
    const checks = await Promise.all(
      images.map((img) =>
        img.buffer
          ? qualityCheck(img.buffer, params.compositionType)
          : Promise.resolve({ passed: true, luminanceScore: 128, safeZoneScore: 0 }),
      ),
    );
    const passed = images.filter((_, i) => checks[i].passed);

    if (passed.length > 0) {
      await writeImageLog({
        ...logBase,
        brandProfileId: params.brandProfileId,
        brandProfileVersion: params.brandProfileVersion,
        aspectRatio: params.aspectRatio,
        postMasterId: params.postMasterId,
        triggeredBy: params.triggeredBy,
        outcome: "retry_success",
        retryCount: 2,
        backgroundStoragePath: passed[0].storagePath,
        qualityCheck: checks[0],
      });
      return passed;
    }

    logger.warn("Quality check failed on attempt 3 (different style)", logBase);
  } catch (err) {
    logger.warn("Attempt 3 (different style) failed", {
      ...logBase,
      error: String(err),
    });
  }

  // All 3 attempts failed — escalate to human.
  await escalateToHuman(params);
  await writeImageLog({
    ...logBase,
    brandProfileId: params.brandProfileId,
    brandProfileVersion: params.brandProfileVersion,
    aspectRatio: params.aspectRatio,
    postMasterId: params.postMasterId,
    triggeredBy: params.triggeredBy,
    outcome: "escalated",
    retryCount: 3,
    fallbackUsed: true,
    errorClass: "AllAttemptsExhausted",
    errorDetail: "3 Ideogram attempts all failed quality check or errored",
  });
  throw new ImageGenerationError(
    "Image generation failed after all attempts — Opollo staff notified",
  );
}

async function escalateToHuman(params: GenerationParams): Promise<void> {
  logger.error("Image generation escalated — all 3 attempts failed", {
    companyId: params.companyId,
    styleId: params.styleId,
    compositionType: params.compositionType,
    aspectRatio: params.aspectRatio,
  });

  // Non-blocking — escalation failure must not propagate to the caller.
  void dispatch({
    event: "image_generation_failed",
    companyId: params.companyId,
    styleId: params.styleId,
    compositionType: params.compositionType,
    aspectRatio: params.aspectRatio,
    attemptsCount: 3,
  }).catch((err) => {
    logger.warn("image.escalation.dispatch_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

async function writeImageLog(params: {
  companyId: string;
  brandProfileId?: string;
  brandProfileVersion?: number;
  styleId: string;
  compositionType: string;
  aspectRatio: string;
  outcome: ImageGenOutcome | string;
  retryCount: number;
  fallbackUsed?: boolean;
  backgroundStoragePath?: string;
  outputStoragePath?: string;
  postMasterId?: string;
  triggeredBy?: string;
  errorClass?: string;
  errorDetail?: string;
  generationDurationMs?: number;
  compositingDurationMs?: number;
  qualityCheck?: {
    passed: boolean;
    luminanceScore: number;
    safeZoneScore: number;
  };
}): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("image_generation_log").insert({
    company_id: params.companyId,
    brand_profile_id: params.brandProfileId ?? null,
    brand_profile_version: params.brandProfileVersion ?? null,
    style_id: params.styleId,
    composition_type: params.compositionType,
    aspect_ratio: params.aspectRatio,
    model_used: "ideogram-v3-flash",
    model_tier: "standard",
    prompt_used: "",
    outcome: params.outcome,
    retry_count: params.retryCount,
    fallback_used: params.fallbackUsed ?? false,
    quality_check_passed: params.qualityCheck?.passed ?? null,
    luminance_score: params.qualityCheck?.luminanceScore ?? null,
    safe_zone_score: params.qualityCheck?.safeZoneScore ?? null,
    background_storage_path: params.backgroundStoragePath ?? null,
    output_storage_path: params.outputStoragePath ?? null,
    post_master_id: params.postMasterId ?? null,
    error_class: params.errorClass ?? null,
    error_detail: params.errorDetail ?? null,
    generation_duration_ms: params.generationDurationMs ?? null,
    compositing_duration_ms: params.compositingDurationMs ?? null,
    triggered_by: params.triggeredBy ?? null,
  });

  if (error) {
    logger.error("Failed to write image_generation_log", {
      error: error.message,
      companyId: params.companyId,
    });
  }
}
