import "server-only";

import { logger } from "@/lib/logger";
import { getAllowedStyles } from "@/lib/image";
import { getServiceRoleClient } from "@/lib/supabase";
import { enqueueImageJob } from "@/lib/image/enqueue";
import { MASS_GEN_PLATFORM_MAP } from "@/lib/image/types";
import type { BrandProfile } from "@/lib/platform/brand/types";
import type { GenerationParams, StyleId, AspectRatio } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// I5 / A5 — CAP image generation trigger.
//
// Called after each social_post_draft is created by the CAP generator.
// Replaces the bare `void generateWithFallback()` fire-and-forget pattern
// with a durable QStash dispatch so Vercel function termination cannot cut
// the generation short.
//
// Flow:
//   1. Create an image_generation_jobs row (state=pending)
//   2. Enqueue to /api/internal/image/qstash-handler via QStash
//   3. The handler runs generateWithFallback() + compositeImage() durably
//   4. On success: creates social_media_assets + links to draft
//
// Uses code templates from lib/image/compositing/templates-v1.ts (A-NEW-1).
// Will be migrated to database templates in A-NEW-4.
//
// Guard: skips silently when IDEOGRAM_API_KEY or QSTASH_TOKEN is unset.
// ---------------------------------------------------------------------------

const DEFAULT_STYLE: StyleId = "clean_corporate";
const DEFAULT_COLOUR = "#1a56db";
const DEFAULT_ASPECT: AspectRatio = "1x1"; // fallback when no platform info

function firstSentence(text: string, maxLen: number): string {
  if (!text) return "";
  const sentence = text.split(/[.!?]/)[0]?.trim() ?? text.trim();
  return sentence.length > maxLen ? sentence.slice(0, maxLen) : sentence;
}

function aspectRatioForPlatforms(platforms: string[] | null): AspectRatio {
  if (!platforms || platforms.length === 0) return DEFAULT_ASPECT;
  // Pick the first distinct platform that has a mapping.
  for (const p of platforms) {
    const ratio = MASS_GEN_PLATFORM_MAP[p.toLowerCase()];
    if (ratio) return ratio;
  }
  return DEFAULT_ASPECT;
}

export async function triggerCAPImageGen(opts: {
  companyId: string;
  draftId: string;
  brand: BrandProfile | null;
  /** Post copy — used to derive headline text for the composite overlay. */
  masterText?: string;
  /** Platform codes from the draft — used to derive aspect ratio. */
  targetPlatforms?: string[] | null;
}): Promise<void> {
  const { companyId, draftId, brand, masterText, targetPlatforms } = opts;

  if (!process.env.IDEOGRAM_API_KEY) {
    logger.debug("cap.image.skipped — IDEOGRAM_API_KEY not set", { draftId });
    return;
  }

  if (!process.env.QSTASH_TOKEN) {
    logger.debug("cap.image.skipped — QSTASH_TOKEN not set", { draftId });
    return;
  }

  const allowedStyles = getAllowedStyles(brand);
  const aspectRatio = aspectRatioForPlatforms(targetPlatforms ?? null);

  const generationParams: GenerationParams = {
    styleId: allowedStyles[0] ?? DEFAULT_STYLE,
    primaryColour: brand?.primary_colour ?? DEFAULT_COLOUR,
    compositionType: "split_layout",
    aspectRatio,
    count: 1,
    industry: brand?.industry ?? undefined,
    companyId,
    brandProfileId: brand?.id,
    brandProfileVersion: brand?.version,
    postMasterId: draftId,
  };

  // Headline: first sentence of post copy (truncated by aspect ratio).
  const maxHeadlineLen = aspectRatio === "16x9" || aspectRatio === "9x16" ? 120 : 80;
  const headlineText = masterText ? firstSentence(masterText, maxHeadlineLen) : undefined;

  // Logo URL from brand profile (compositor handles absent/expired URL gracefully).
  const logoUrl = brand?.logo_icon_url ?? brand?.logo_primary_url ?? undefined;

  const svc = getServiceRoleClient();

  // Create a job row so the handler can track state durably.
  const { data: job, error: jobErr } = await svc
    .from("image_generation_jobs")
    .insert({
      company_id: companyId,
      state: "pending",
      generation_params: generationParams,
    })
    .select("id")
    .single();

  if (jobErr || !job?.id) {
    logger.warn("cap.image.job_create_failed", { draftId, err: jobErr?.message });
    return;
  }

  const jobId = job.id as string;

  const enqueue = await enqueueImageJob({
    jobId,
    generationParams,
    capDraftId: draftId,
    headlineText: headlineText ?? "New post",
    logoUrl,
  });

  if (!enqueue.ok) {
    logger.warn("cap.image.enqueue_failed", { draftId, jobId, error: enqueue.error });
    // Clean up the job row so it doesn't linger as a phantom pending job.
    await svc.from("image_generation_jobs").update({ state: "failed", error_class: "EnqueueFailed", error_detail: enqueue.error }).eq("id", jobId);
    return;
  }

  logger.info("cap.image.enqueued", { draftId, companyId, jobId, aspectRatio });
}
