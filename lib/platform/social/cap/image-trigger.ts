import "server-only";

import { logger } from "@/lib/logger";
import { generateWithFallback, getAllowedStyles } from "@/lib/image";
import { getServiceRoleClient } from "@/lib/supabase";
import type { BrandProfile } from "@/lib/platform/brand/types";
import type { GenerationParams, StyleId } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// I5 — CAP image generation trigger.
//
// Called fire-and-forget after each social_post_master is created by the
// CAP generator. Maps the active BrandProfile to GenerationParams, calls
// generateWithFallback, creates a social_media_assets row, and links the
// asset to all existing variants of the post.
//
// All failures are non-blocking — a failure here must NOT propagate to
// the CAP generation result.
//
// Guard: skips silently when IDEOGRAM_API_KEY is unset (local / test).
// ---------------------------------------------------------------------------

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL_SECONDS = 365 * 24 * 3600; // 1 year

const DEFAULT_STYLE: StyleId = "clean_corporate";
const DEFAULT_COLOUR = "#1a56db";

function brandToGenerationParams(
  brand: BrandProfile | null,
  companyId: string,
  draftId: string,
): GenerationParams {
  const allowedStyles = getAllowedStyles(brand);
  const styleId = allowedStyles[0] ?? DEFAULT_STYLE;
  const primaryColour = brand?.primary_colour ?? DEFAULT_COLOUR;

  return {
    styleId,
    primaryColour,
    compositionType: "split_layout",
    aspectRatio: "ASPECT_1_1",
    model: "standard",
    count: 1,
    industry: brand?.industry ?? undefined,
    companyId,
    brandProfileId: brand?.id,
    brandProfileVersion: brand?.version,
    postMasterId: draftId,
    triggeredBy: undefined,
  };
}

export async function triggerCAPImageGen(opts: {
  companyId: string;
  draftId: string;
  brand: BrandProfile | null;
}): Promise<void> {
  const { companyId, draftId, brand } = opts;

  // Skip silently when image generation is not configured.
  if (!process.env.IDEOGRAM_API_KEY) {
    logger.debug("cap.image.skipped — IDEOGRAM_API_KEY not set", { draftId });
    return;
  }

  const params = brandToGenerationParams(brand, companyId, draftId);

  let images: Awaited<ReturnType<typeof generateWithFallback>>;
  try {
    images = await generateWithFallback(params);
  } catch (err) {
    logger.warn("cap.image.generate_failed", {
      draftId,
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!images || images.length === 0) {
    logger.warn("cap.image.no_images_returned", { draftId, companyId });
    return;
  }

  const image = images[0]!;
  const svc = getServiceRoleClient();

  // Get a long-lived signed URL to serve as the public source_url.
  const { data: signed, error: signedErr } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrl(image.storagePath, SIGNED_URL_TTL_SECONDS);

  if (signedErr || !signed?.signedUrl) {
    logger.warn("cap.image.signed_url_failed", {
      draftId,
      path: image.storagePath,
      err: signedErr?.message,
    });
    return;
  }

  // Persist the generated image as a social_media_assets row.
  const { data: asset, error: assetErr } = await svc
    .from("social_media_assets")
    .insert({
      company_id: companyId,
      storage_path: image.storagePath,
      mime_type: `image/${image.format ?? "jpeg"}`,
      bytes: image.buffer?.length ?? 0,
      source_url: signed.signedUrl,
      width: image.width ?? null,
      height: image.height ?? null,
    })
    .select("id")
    .single();

  if (assetErr || !asset?.id) {
    logger.warn("cap.image.asset_insert_failed", {
      draftId,
      err: assetErr?.message,
    });
    return;
  }

  const assetId = asset.id as string;

  // Link the signed URL to the V2 draft's media_urls array.
  const { error: draftErr } = await svc
    .from("social_post_drafts")
    .update({ media_urls: [signed.signedUrl] })
    .eq("id", draftId);

  if (draftErr) {
    logger.warn("cap.image.draft_link_failed", {
      draftId,
      assetId,
      err: draftErr.message,
    });
    return;
  }

  logger.info("cap.image.done", { draftId, companyId, assetId });
}
