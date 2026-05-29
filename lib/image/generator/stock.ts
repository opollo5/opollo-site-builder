import "server-only";

import type { GeneratedImage, GenerationParams, StyleId } from "../types";
import { generateBackground } from "./ideogram";

// ---------------------------------------------------------------------------
// Third-attempt regenerate — replaces the dead image_stock_library fallback.
//
// The `image_stock_library` table never existed in any migration (recon §1c).
// Per the mass-image-gen brief §3 (out of scope), do not create it. Instead,
// make a third attempt with maximum prompt simplification and a different
// style_id from the five available styles.
//
// If this also fails (quality check or Ideogram error), the caller
// (handler.ts) escalates to the operator via email.
// ---------------------------------------------------------------------------

const ALL_STYLES: StyleId[] = [
  "clean_corporate",
  "bold_promo",
  "minimal_modern",
  "editorial",
  "product_focus",
];

/**
 * Third-attempt generation: try a different style with maximum simplification.
 * Returns the first image that passes or throws if Ideogram fails.
 * Quality checks are the caller's responsibility.
 */
export async function thirdAttemptFallback(
  params: GenerationParams,
): Promise<GeneratedImage[]> {
  // Pick the first style that differs from the one that already failed twice.
  const fallbackStyle = ALL_STYLES.find((s) => s !== params.styleId) ?? "clean_corporate";

  return generateBackground({
    ...params,
    styleId: fallbackStyle,
    simplifyPrompt: true,
  });
}
