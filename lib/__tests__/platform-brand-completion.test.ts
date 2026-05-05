import { describe, expect, it } from "vitest";

import { type BrandProfile, getBrandTier } from "@/lib/platform/brand";

// P-Brand-1a — pure function. No DB. Asserts the tier ladder defined in
// lib/platform/brand/completion.ts. The ladder is consumed by the
// completion-prompt UI on /company and (eventually) by image generation
// + CAP routing, so the boundary cases here are load-bearing.

function baseBrand(): BrandProfile {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    company_id: "22222222-2222-2222-2222-222222222222",
    version: 1,
    is_active: true,
    change_summary: null,
    primary_colour: null,
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
    default_approval_rule: "any_one",
    platform_overrides: {},
    hashtag_strategy: "minimal",
    max_post_length: "medium",
    content_restrictions: [],
    updated_by: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe("lib/platform/brand/completion — getBrandTier", () => {
  it("returns 'none' when brand is null (no profile yet)", () => {
    expect(getBrandTier(null)).toBe("none");
  });

  it("returns 'none' when minimal fields are missing", () => {
    expect(getBrandTier(baseBrand())).toBe("none");
  });

  it("returns 'none' when only one of the minimal pair is present", () => {
    const onlyColour = { ...baseBrand(), primary_colour: "#FF03A5" };
    expect(getBrandTier(onlyColour)).toBe("none");

    const onlyLogo = {
      ...baseBrand(),
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
    };
    expect(getBrandTier(onlyLogo)).toBe("none");
  });

  it("returns 'minimal' when primary colour + logo are set but tone fields are missing", () => {
    const minimal: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
    };
    expect(getBrandTier(minimal)).toBe("minimal");
  });

  it("returns 'standard' when industry + formality + personality + focus topics are set", () => {
    const standard: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
      industry: "Technology / SaaS",
      formality: "semi_formal",
      personality_traits: ["professional", "approachable"],
      focus_topics: ["cloud cost optimisation"],
    };
    expect(getBrandTier(standard)).toBe("standard");
  });

  it("does not promote to 'standard' if any one standard input is empty", () => {
    const missingPersonality: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
      industry: "Technology / SaaS",
      formality: "semi_formal",
      personality_traits: [], // missing
      focus_topics: ["cloud cost optimisation"],
    };
    expect(getBrandTier(missingPersonality)).toBe("minimal");

    const missingFocus: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
      industry: "Technology / SaaS",
      formality: "semi_formal",
      personality_traits: ["professional"],
      focus_topics: [], // missing
    };
    expect(getBrandTier(missingFocus)).toBe("minimal");
  });

  it("returns 'complete' when voice_examples + platform_overrides + image_style are populated", () => {
    const complete: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
      industry: "Technology / SaaS",
      formality: "semi_formal",
      personality_traits: ["professional", "approachable"],
      focus_topics: ["cloud cost optimisation"],
      voice_examples: ["Cut your AWS bill by 30% in 90 days, no code changes."],
      platform_overrides: { linkedin: { use_hashtags: true } },
      image_style: { mood: "clean modern", composition_notes: "spacious" },
    };
    expect(getBrandTier(complete)).toBe("complete");
  });

  it("does not promote to 'complete' if image_style is empty even when other fields are present", () => {
    const almostComplete: BrandProfile = {
      ...baseBrand(),
      primary_colour: "#FF03A5",
      logo_primary_url: "https://cdn.opollo.com/logo.svg",
      industry: "Technology / SaaS",
      formality: "semi_formal",
      personality_traits: ["professional"],
      focus_topics: ["cloud cost"],
      voice_examples: ["sample"],
      platform_overrides: { linkedin: {} },
      image_style: {}, // empty
    };
    expect(getBrandTier(almostComplete)).toBe("standard");
  });
});
