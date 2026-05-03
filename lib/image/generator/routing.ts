import type { BrandProfile } from "@/lib/platform/brand";

import type { ModelTier, StyleId } from "../types";
import { StyleBlockedError } from "../types";

const SAFE_MODE_BLOCKED_STYLES: StyleId[] = ["bold_promo", "editorial"];

export function validateStyleForBrand(
  styleId: StyleId,
  brand: BrandProfile | null,
): void {
  if (brand?.safe_mode && SAFE_MODE_BLOCKED_STYLES.includes(styleId)) {
    throw new StyleBlockedError(
      `${styleId} is not available for this client (safe_mode is on)`,
    );
  }
  if (
    brand?.approved_style_ids?.length &&
    !brand.approved_style_ids.includes(styleId)
  ) {
    throw new StyleBlockedError(
      `${styleId} is not in this client's approved style list`,
    );
  }
}

export function getAllowedStyles(brand: BrandProfile | null): StyleId[] {
  const all: StyleId[] = [
    "clean_corporate",
    "bold_promo",
    "minimal_modern",
    "editorial",
    "product_focus",
  ];
  if (!brand) return all;

  let allowed =
    brand.approved_style_ids?.length
      ? (brand.approved_style_ids as StyleId[])
      : all;

  if (brand.safe_mode) {
    allowed = allowed.filter((s) => !SAFE_MODE_BLOCKED_STYLES.includes(s));
  }
  return allowed;
}

export function selectModelTier(opts: {
  isHighValue?: boolean;
  isCampaign?: boolean;
  previousRejectionCount?: number;
}): ModelTier {
  if (opts.isHighValue) return "premium";
  if (opts.isCampaign) return "premium";
  if ((opts.previousRejectionCount ?? 0) >= 2) return "premium";
  return "standard";
}
