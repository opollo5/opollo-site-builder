import type { BrandProfile } from "./types";

// Brand completion tier — drives "set up your brand" prompts in the UI
// and routes degraded-mode behaviour in image generation / CAP. Products
// must continue to function at every tier; lower tiers just produce
// less brand-tailored output.
//
// Tiers (in order — each row's check is a superset of the row below):
//
//   none      No active profile, OR profile exists but lacks both
//             primary_colour AND a primary logo. Image generation falls
//             back to neutral colour + no logo overlay; CAP uses
//             generic tone defaults.
//
//   minimal   Has primary_colour + logo_primary_url but no industry /
//             formality / personality / focus_topics. Image generation
//             can use brand colour but tone is generic.
//
//   standard  Has minimal + industry + formality + at least one
//             personality trait + at least one focus topic. CAP can
//             write on-brand at a coarse grain.
//
//   complete  Has standard + voice_examples (so CAP has anchor copy) +
//             platform_overrides set + image_style customised. Top-tier
//             product output.

export type BrandTier = "none" | "minimal" | "standard" | "complete";

export function getBrandTier(brand: BrandProfile | null): BrandTier {
  if (!brand) return "none";

  const hasMinimal = !!(brand.primary_colour && brand.logo_primary_url);
  if (!hasMinimal) return "none";

  const hasStandard = !!(
    brand.industry &&
    brand.formality &&
    brand.personality_traits.length > 0 &&
    brand.focus_topics.length > 0
  );
  if (!hasStandard) return "minimal";

  const hasComplete = !!(
    brand.voice_examples.length > 0 &&
    Object.keys(brand.platform_overrides).length > 0 &&
    Object.keys(brand.image_style).length > 0
  );
  return hasComplete ? "complete" : "standard";
}

// Display copy for each tier. Used by the "complete your brand" prompt
// and the brand profile page header.
export function brandTierLabel(tier: BrandTier): string {
  switch (tier) {
    case "none":
      return "Not started";
    case "minimal":
      return "Minimal";
    case "standard":
      return "Standard";
    case "complete":
      return "Complete";
  }
}

export function brandTierDescription(tier: BrandTier): string {
  switch (tier) {
    case "none":
      return "Add a primary colour and logo to start tailoring your content.";
    case "minimal":
      return "Add industry, tone, and focus topics so we can write on-brand for you.";
    case "standard":
      return "Add voice examples and platform-specific overrides for top-tier output.";
    case "complete":
      return "Your brand is fully set up.";
  }
}
