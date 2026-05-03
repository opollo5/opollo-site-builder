import { describe, expect, it } from "vitest";

import {
  type FormState,
  buildPatch,
} from "@/components/CustomerBrandProfileEditor";
import type { BrandProfile } from "@/lib/platform/brand";

// P-Brand-1c — diff-only patch builder. Load-bearing because the PATCH
// API's RPC COALESCEs against the current row: any field we send through
// overwrites, so we MUST drop unchanged fields. Empty string in the form
// is the operator clearing a value → must serialise as null. Unchanged
// fields → must be absent from the patch object entirely.

function baseBrand(): BrandProfile {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    company_id: "22222222-2222-2222-2222-222222222222",
    version: 3,
    is_active: true,
    change_summary: null,
    primary_colour: "#FF03A5",
    secondary_colour: null,
    accent_colour: null,
    logo_primary_url: null,
    logo_dark_url: null,
    logo_light_url: null,
    logo_icon_url: null,
    heading_font: "EmBauhausW00",
    body_font: null,
    image_style: {},
    approved_style_ids: [],
    safe_mode: false,
    personality_traits: [],
    formality: "formal",
    point_of_view: null,
    preferred_vocabulary: [],
    avoided_terms: [],
    voice_examples: [],
    focus_topics: [],
    avoided_topics: [],
    industry: "SaaS",
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

function formFromBrand(brand: BrandProfile): FormState {
  return {
    primary_colour: brand.primary_colour ?? "",
    secondary_colour: brand.secondary_colour ?? "",
    accent_colour: brand.accent_colour ?? "",
    heading_font: brand.heading_font ?? "",
    body_font: brand.body_font ?? "",
    formality: brand.formality ?? "",
    point_of_view: brand.point_of_view ?? "",
    industry: brand.industry ?? "",
    safe_mode: brand.safe_mode,
    change_summary: "",
    submitting: false,
    error: null,
    success: null,
  };
}

describe("CustomerBrandProfileEditor — buildPatch", () => {
  it("returns an empty patch when nothing changed", () => {
    const brand = baseBrand();
    const form = formFromBrand(brand);
    expect(buildPatch(form, brand)).toEqual({});
  });

  it("includes only changed fields", () => {
    const brand = baseBrand();
    const form = { ...formFromBrand(brand), primary_colour: "#000000" };
    expect(buildPatch(form, brand)).toEqual({ primary_colour: "#000000" });
  });

  it("trims whitespace before comparing", () => {
    const brand = baseBrand();
    // Operator added trailing whitespace but no real change → patch empty.
    const form = { ...formFromBrand(brand), industry: "  SaaS  " };
    expect(buildPatch(form, brand)).toEqual({});
  });

  it("converts empty string to null (operator clearing a value)", () => {
    const brand = baseBrand();
    const form = { ...formFromBrand(brand), heading_font: "" };
    expect(buildPatch(form, brand)).toEqual({ heading_font: null });
  });

  it("converts whitespace-only to null", () => {
    const brand = baseBrand();
    const form = { ...formFromBrand(brand), industry: "   " };
    expect(buildPatch(form, brand)).toEqual({ industry: null });
  });

  it("does not emit safe_mode when its boolean is unchanged", () => {
    const brand = baseBrand();
    const form = formFromBrand(brand); // safe_mode: false === brand.safe_mode
    expect(buildPatch(form, brand)).toEqual({});
  });

  it("emits safe_mode true when toggled on", () => {
    const brand = baseBrand();
    const form = { ...formFromBrand(brand), safe_mode: true };
    expect(buildPatch(form, brand)).toEqual({ safe_mode: true });
  });

  it("creates a full patch when brand is null (first save)", () => {
    const form: FormState = {
      primary_colour: "#FF03A5",
      secondary_colour: "",
      accent_colour: "",
      heading_font: "Inter",
      body_font: "",
      formality: "casual",
      point_of_view: "",
      industry: "Healthcare",
      safe_mode: true,
      change_summary: "",
      submitting: false,
      error: null,
      success: null,
    };
    expect(buildPatch(form, null)).toEqual({
      primary_colour: "#FF03A5",
      heading_font: "Inter",
      formality: "casual",
      industry: "Healthcare",
      safe_mode: true,
    });
  });

  it("emits multiple distinct changes in one patch", () => {
    const brand = baseBrand();
    const form = {
      ...formFromBrand(brand),
      primary_colour: "#000000",
      formality: "casual" as const,
      industry: "Healthcare",
    };
    expect(buildPatch(form, brand)).toEqual({
      primary_colour: "#000000",
      formality: "casual",
      industry: "Healthcare",
    });
  });
});
