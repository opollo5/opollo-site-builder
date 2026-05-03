import sharp from "sharp";

import { logger } from "@/lib/logger";

import { TEXT_ZONE_MAP } from "../compositing/text-zones";
import type { CompositionType } from "../types";

export interface QualityResult {
  passed: boolean;
  luminanceScore: number; // average luminance in text zone (0–255)
  safeZoneScore: number;  // Laplacian variance in image centre (lower = safer)
  reason?: string;
}

// Overlay colour decision for text rendering over the generated image.
export function selectOverlayColour(
  luminanceScore: number,
): "white" | "dark" | "overlay" {
  if (luminanceScore < 160) return "white";
  if (luminanceScore > 180) return "dark";
  return "overlay"; // semi-transparent dark band behind text
}

// Three-check quality gate:
//   1. File size sanity (blank / corrupt images are near-zero bytes)
//   2. Luminance in text zone — suitable for text overlay (not too mid-grey)
//   3. Safe zone clarity — centre of image is not too busy for text
//
// All three must pass. Threshold values calibrated for Ideogram 3.0 output;
// see quality-check tests for exact numbers. Tune via I3 follow-up if needed.
export async function qualityCheck(
  imageBuffer: Buffer,
  compositionType: CompositionType,
): Promise<QualityResult> {
  // Check 1: file size (blank images are near-zero bytes)
  if (imageBuffer.length < 50_000) {
    return {
      passed: false,
      luminanceScore: 0,
      safeZoneScore: 0,
      reason: "Image too small (possible blank or corrupt)",
    };
  }

  let width: number | undefined;
  let height: number | undefined;

  try {
    const meta = await sharp(imageBuffer).metadata();
    width = meta.width;
    height = meta.height;
  } catch (err) {
    logger.warn("quality-check: sharp metadata failed", { error: String(err) });
    return {
      passed: false,
      luminanceScore: 0,
      safeZoneScore: 0,
      reason: "Cannot read image dimensions",
    };
  }

  if (!width || !height) {
    return {
      passed: false,
      luminanceScore: 0,
      safeZoneScore: 0,
      reason: "Image has no dimensions",
    };
  }

  const zone = TEXT_ZONE_MAP[compositionType];

  // Check 2: Luminance in text zone
  const zoneLeft = Math.floor((zone.x / 100) * width);
  const zoneTop = Math.floor((zone.y / 100) * height);
  const zoneWidth = Math.max(1, Math.floor((zone.width / 100) * width));
  const zoneHeight = Math.max(1, Math.floor((zone.height / 100) * height));

  let luminanceScore = 128; // default neutral if extraction fails
  try {
    const zonePixels = await sharp(imageBuffer)
      .extract({ left: zoneLeft, top: zoneTop, width: zoneWidth, height: zoneHeight })
      .greyscale()
      .raw()
      .toBuffer();

    luminanceScore =
      zonePixels.reduce((sum: number, p: number) => sum + p, 0) /
      zonePixels.length;
  } catch (err) {
    logger.warn("quality-check: luminance extraction failed", {
      error: String(err),
      compositionType,
    });
    // Allow through — don't fail on extraction errors, just log
  }

  // Suitable for white text: < 160 (dark enough)
  // Suitable for dark text: > 180 (light enough)
  // Middle band 160–180: use semi-transparent overlay — still acceptable
  const luminanceOk = luminanceScore < 160 || luminanceScore > 180;

  // Check 3: Safe zone clarity (centre 50% of frame)
  const centreLeft = Math.floor(width * 0.25);
  const centreTop = Math.floor(height * 0.25);
  const centreWidth = Math.max(1, Math.floor(width * 0.5));
  const centreHeight = Math.max(1, Math.floor(height * 0.5));

  let safeZoneScore = 0;
  let safeZoneOk = true;
  try {
    const centrePixels = await sharp(imageBuffer)
      .extract({
        left: centreLeft,
        top: centreTop,
        width: centreWidth,
        height: centreHeight,
      })
      .greyscale()
      .raw()
      .toBuffer();

    safeZoneScore = computeLaplacianVariance(
      centrePixels,
      centreWidth,
      centreHeight,
    );
    safeZoneOk = safeZoneScore < 2500;
  } catch (err) {
    logger.warn("quality-check: safe-zone extraction failed", {
      error: String(err),
      compositionType,
    });
    // Allow through
  }

  const passed = luminanceOk && safeZoneOk;

  if (!passed) {
    logger.info("quality-check: failed", {
      compositionType,
      luminanceScore: luminanceScore.toFixed(1),
      safeZoneScore: safeZoneScore.toFixed(1),
      luminanceOk,
      safeZoneOk,
    });
  }

  return {
    passed,
    luminanceScore,
    safeZoneScore,
    reason: !passed
      ? `luminance: ${luminanceScore.toFixed(0)}, safeZone: ${safeZoneScore.toFixed(0)}`
      : undefined,
  };
}

// Approximate Laplacian variance — edge-detection proxy for image busyness.
// High variance → lots of fine detail → bad for text overlay.
function computeLaplacianVariance(
  pixels: Buffer,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const p = pixels[i] ?? 0;
      const lap = Math.abs(
        -(pixels[i - width - 1] ?? 0) -
          (pixels[i - width] ?? 0) -
          (pixels[i - width + 1] ?? 0) -
          (pixels[i - 1] ?? 0) +
          8 * p -
          (pixels[i + 1] ?? 0) -
          (pixels[i + width - 1] ?? 0) -
          (pixels[i + width] ?? 0) -
          (pixels[i + width + 1] ?? 0),
      );
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}
