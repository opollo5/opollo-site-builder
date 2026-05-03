import { describe, expect, it } from "vitest";

import { getAllowedStyles, selectModelTier, validateStyleForBrand } from "@/lib/image/generator/routing";
import { StyleBlockedError } from "@/lib/image/types";
import type { BrandProfile } from "@/lib/platform/brand";

function fakeBrand(overrides: Partial<BrandProfile> = {}): BrandProfile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    company_id: "00000000-0000-0000-0000-000000000002",
    version: 1,
    is_active: true,
    change_summary: null,
    primary_colour: "#FF03A5",
    secondary_colour: null,
    accent_colour: null,
    logo_primary_url: null,
    logo_dark_url: null,
    logo_light_url: null,
    logo_icon_url: null,
    heading_font: null,
    body_font: null,
    image_style: {},
    approved_style_ids: [],
    safe_mode: false,
    personality_traits: [],
    formality: null,
    point_of_view: null,
    preferred_vocabulary: [],
    avoided_terms: [],
    voice_examples: [],
    focus_topics: [],
    avoided_topics: [],
    industry: null,
    default_approval_required: true,
    default_approval_rule: null,
    platform_overrides: {},
    hashtag_strategy: null,
    max_post_length: null,
    content_restrictions: [],
    updated_by: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getAllowedStyles", () => {
  it("returns all styles when brand is null", () => {
    const styles = getAllowedStyles(null);
    expect(styles).toHaveLength(5);
    expect(styles).toContain("bold_promo");
    expect(styles).toContain("editorial");
  });

  it("filters safe-mode-blocked styles when safe_mode=true", () => {
    const brand = fakeBrand({ safe_mode: true });
    const styles = getAllowedStyles(brand);
    expect(styles).not.toContain("bold_promo");
    expect(styles).not.toContain("editorial");
    expect(styles).toContain("clean_corporate");
    expect(styles).toContain("minimal_modern");
    expect(styles).toContain("product_focus");
  });

  it("respects approved_style_ids", () => {
    const brand = fakeBrand({
      approved_style_ids: ["clean_corporate", "minimal_modern"],
    });
    const styles = getAllowedStyles(brand);
    expect(styles).toEqual(["clean_corporate", "minimal_modern"]);
  });

  it("combines safe_mode filter with approved_style_ids", () => {
    const brand = fakeBrand({
      safe_mode: true,
      approved_style_ids: ["clean_corporate", "bold_promo", "editorial"],
    });
    const styles = getAllowedStyles(brand);
    // bold_promo and editorial blocked by safe_mode
    expect(styles).toEqual(["clean_corporate"]);
  });
});

describe("validateStyleForBrand", () => {
  it("does not throw for allowed style with null brand", () => {
    expect(() => validateStyleForBrand("bold_promo", null)).not.toThrow();
  });

  it("throws StyleBlockedError when style is blocked by safe_mode", () => {
    const brand = fakeBrand({ safe_mode: true });
    expect(() => validateStyleForBrand("bold_promo", brand)).toThrow(
      StyleBlockedError,
    );
    expect(() => validateStyleForBrand("editorial", brand)).toThrow(
      StyleBlockedError,
    );
  });

  it("does not throw for allowed style when safe_mode=true", () => {
    const brand = fakeBrand({ safe_mode: true });
    expect(() =>
      validateStyleForBrand("clean_corporate", brand),
    ).not.toThrow();
  });

  it("throws when style not in approved_style_ids", () => {
    const brand = fakeBrand({ approved_style_ids: ["clean_corporate"] });
    expect(() => validateStyleForBrand("bold_promo", brand)).toThrow(
      StyleBlockedError,
    );
  });
});

describe("selectModelTier", () => {
  it("returns standard by default", () => {
    expect(selectModelTier({})).toBe("standard");
  });

  it("returns premium for high-value clients", () => {
    expect(selectModelTier({ isHighValue: true })).toBe("premium");
  });

  it("returns premium for campaign context", () => {
    expect(selectModelTier({ isCampaign: true })).toBe("premium");
  });

  it("returns premium after 2 rejections", () => {
    expect(selectModelTier({ previousRejectionCount: 2 })).toBe("premium");
    expect(selectModelTier({ previousRejectionCount: 3 })).toBe("premium");
    expect(selectModelTier({ previousRejectionCount: 1 })).toBe("standard");
  });
});
