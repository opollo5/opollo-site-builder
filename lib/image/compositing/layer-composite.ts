/**
 * layer-composite — Supabase Storage upload wrapper for layer-based renders.
 *
 * Called by compositeImage() (index.ts) when the input carries schema_version=2.
 * Delegates rendering to renderTemplate() (layer-renderer.ts) then uploads
 * the PNG/JPEG output to the generated-images bucket.
 *
 * Does NOT touch sharp-renderer.ts (the fixed-zone v1 path).
 */

import "server-only";

import sharp from "sharp";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { LayerCompositeInput, CompositeResult } from "./index";

const BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";

/**
 * Render a layer-based template and upload the output to Supabase Storage.
 * Returns a CompositeResult matching the shape returned by compositeSharp().
 */
export async function compositeLayerBased(
  input: LayerCompositeInput,
): Promise<CompositeResult> {
  const startMs = Date.now();
  const { renderTemplate } = await import("./layer-renderer");

  // 1. Render template → PNG buffer.
  const { png } = await renderTemplate({
    template: input.template,
    modifications: input.modifications,
    variantKey: input.variantKey,
  });

  // 2. Convert to output format (default: PNG; lossy if jpeg requested).
  const fmt = input.outputFormat ?? "png";
  let outputBuf: Buffer;
  if (fmt === "jpeg") {
    const quality = input.template.render_settings.quality ?? 90;
    outputBuf = await sharp(png).jpeg({ quality }).toBuffer();
  } else {
    outputBuf = png;
  }

  const contentType = fmt === "jpeg" ? "image/jpeg" : "image/png";

  // 3. Upload to Storage.
  const svc = getServiceRoleClient();
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(input.outputStoragePath, outputBuf, {
      contentType,
      upsert: true,
    });

  if (error) {
    logger.error("image.compositor.layer.upload_failed", {
      path: input.outputStoragePath,
      error: error.message,
    });
    throw new Error(`Layer compositor: storage upload failed (${error.message})`);
  }

  const durationMs = Date.now() - startMs;
  logger.info("image.compositor.layer.completed", {
    storagePath: input.outputStoragePath,
    format: fmt,
    durationMs,
    layers: input.template.layers.length,
  });

  return {
    storagePath: input.outputStoragePath,
    provider: "sharp_layer_native",
    durationMs,
  };
}
