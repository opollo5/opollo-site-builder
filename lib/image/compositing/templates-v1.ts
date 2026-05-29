// ---------------------------------------------------------------------------
// templates-v1.ts — Hard-coded code-template constants, one per aspect ratio.
//
// TEMPORARY: This file exists so slices A4 and A5 can ship composited
// output before the database-backed template storage (A-NEW-2) and template
// editor (A-NEW-3) land. It will be DELETED in A-NEW-4 once the five seed
// templates have been migrated to the image_templates table.
//
// Per §1.8 of MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md:
//   - No slice may bypass compositeImage() or call sharp directly.
//   - Templates are code constants here; database-backed after A-NEW-2.
// ---------------------------------------------------------------------------

import type { AspectRatio } from "../types";
import type { LogoConfig } from "./index";
import type { CompositionType } from "../types";

export interface TemplateV1 {
  aspectRatio: AspectRatio;
  compositionType: CompositionType;
  overlayAlpha: number;                    // 0.0 – 1.0
  logoPosition: LogoConfig["position"];
  logoSizePercent: number;                 // logo as % of shorter canvas dimension
  logoPadding: number;                     // px padding from edge
  maxHeadlineFontSize: number;             // px — text auto-fit ceiling
}

// One template per §1.1 aspect ratio.
// Layout rationale documented inline.
export const TEMPLATES_V1: Record<AspectRatio, TemplateV1> = {
  "1x1": {
    aspectRatio: "1x1",
    compositionType: "split_layout",  // text zone: right 37% of frame
    overlayAlpha: 0.75,
    logoPosition: "bottom-right",
    logoSizePercent: 18,
    logoPadding: 24,
    maxHeadlineFontSize: 56,
  },
  "4x5": {
    aspectRatio: "4x5",
    compositionType: "split_layout",  // portrait — text right-band works well
    overlayAlpha: 0.75,
    logoPosition: "bottom-right",
    logoSizePercent: 16,
    logoPadding: 24,
    maxHeadlineFontSize: 52,
  },
  "9x16": {
    aspectRatio: "9x16",
    compositionType: "full_background",  // story — overlay at bottom 30%
    overlayAlpha: 0.82,
    logoPosition: "bottom-left",
    logoSizePercent: 14,
    logoPadding: 28,
    maxHeadlineFontSize: 48,
  },
  "16x9": {
    aspectRatio: "16x9",
    compositionType: "gradient_fade",   // landscape — text left-band
    overlayAlpha: 0.78,
    logoPosition: "bottom-right",
    logoSizePercent: 14,
    logoPadding: 24,
    maxHeadlineFontSize: 52,
  },
  "4x3": {
    aspectRatio: "4x3",
    compositionType: "split_layout",   // GBP landscape — right-band text
    overlayAlpha: 0.75,
    logoPosition: "bottom-right",
    logoSizePercent: 16,
    logoPadding: 24,
    maxHeadlineFontSize: 48,
  },
};

export function getTemplateV1(aspectRatio: AspectRatio): TemplateV1 {
  return TEMPLATES_V1[aspectRatio];
}
