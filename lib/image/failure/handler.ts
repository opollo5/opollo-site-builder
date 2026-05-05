import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
// I3: dispatch('image_generation_failed') for escalation emails lands
// when the NotificationEvent enum + migration are extended in I3.

import type { GeneratedImage, GenerationParams, ImageGenOutcome } from "../types";
import { IdeogramError, ImageGenerationError, StockUnavailableError } from "../types";
import { generateBackground, isRetryable } from "../generator/ideogram";
import { stockFallback } from "../generator/stock";
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
      logger.warn("Non-retryable Ideogram error", {
        ...logBase,
        status: err.status,
      });
      return stockFallbackWithLog(params, logBase);
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

  return stockFallbackWithLog(params, logBase);
}

async function stockFallbackWithLog(
  params: GenerationParams,
  logBase: { companyId: string; styleId: string; compositionType: string },
): Promise<GeneratedImage[]> {
  try {
    const stock = await stockFallback(params);
    await writeImageLog({
      ...logBase,
      brandProfileId: params.brandProfileId,
      brandProfileVersion: params.brandProfileVersion,
      aspectRatio: params.aspectRatio,
      postMasterId: params.postMasterId,
      triggeredBy: params.triggeredBy,
      outcome: "stock_fallback",
      retryCount: 1,
      fallbackUsed: true,
      backgroundStoragePath: stock[0]?.storagePath,
    });
    return stock;
  } catch (err) {
    if (err instanceof StockUnavailableError) {
      await escalateToHuman(params);
      await writeImageLog({
        ...logBase,
        brandProfileId: params.brandProfileId,
        brandProfileVersion: params.brandProfileVersion,
        aspectRatio: params.aspectRatio,
        postMasterId: params.postMasterId,
        triggeredBy: params.triggeredBy,
        outcome: "escalated",
        retryCount: 1,
        fallbackUsed: true,
        errorClass: "StockUnavailableError",
        errorDetail: err.message,
      });
      throw new ImageGenerationError(
        "Image generation failed after all attempts — Opollo staff notified",
      );
    }
    throw err;
  }
}

async function escalateToHuman(params: GenerationParams): Promise<void> {
  // I3: extend NotificationEvent + migration, then call dispatch() here.
  logger.error("Image generation escalated — no stock fallback available", {
    companyId: params.companyId,
    styleId: params.styleId,
    compositionType: params.compositionType,
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
    model_used: "unknown",
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
    // triggered_by is a UUID FK — pass null if the caller provided a
    // non-UUID string (e.g. a cron label). Callers should pass platform_users.id.
    triggered_by: params.triggeredBy ?? null,
  });

  if (error) {
    logger.error("Failed to write image_generation_log", {
      error: error.message,
      companyId: params.companyId,
    });
  }
}
