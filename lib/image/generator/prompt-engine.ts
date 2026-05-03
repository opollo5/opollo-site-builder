import type { CompositionType, StyleId } from "../types";

export type { StyleId, CompositionType };
export type { AspectRatio } from "../types";

interface PromptParams {
  styleId: StyleId;
  primaryColour: string;
  compositionType: CompositionType;
  industry?: string;
  mood?: string;
  safeMode?: boolean;
  simplify?: boolean; // retry pass — strip optional modifiers
}

export function buildPrompt(params: PromptParams): string {
  const base = STYLE_BASES[params.styleId];
  const composition = COMPOSITION_MODIFIERS[params.compositionType];
  const colourDesc = hexToColourDescription(params.primaryColour);
  const safeMod = params.safeMode
    ? "photographic realism, stock photography style, "
    : "";

  if (params.simplify) {
    // Retry pass — minimal prompt to maximise generation success rate
    return `${safeMod}${base}, ${composition}, no text, no words, no letters, no typography`.trim();
  }

  const industryCtx =
    params.industry ? (INDUSTRY_MODIFIERS[params.industry] ?? "") : "";
  const moodMod = params.mood ? `${params.mood} mood, ` : "";
  const industryPart = industryCtx ? `, ${industryCtx}` : "";

  return `${safeMod}${moodMod}${base}, ${composition}, ${colourDesc} colour accent${industryPart}, no text, no words, no letters, no typography`.trim();
}

function hexToColourDescription(hex: string): string {
  const clean = hex.replace(/^#/, "").toLowerCase();
  // Map rough hue buckets to descriptor words for more natural prompts
  if (!clean || clean.length < 6) return "neutral";

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2 / 255;

  if (lightness < 0.15) return "deep dark";
  if (lightness > 0.85) return "light neutral";

  if (r > g + 60 && r > b + 60) return "warm red";
  if (g > r + 30 && g > b + 30) return "fresh green";
  if (b > r + 30 && b > g + 30) return "cool blue";
  if (r > 200 && g > 150 && b < 80) return "warm golden";
  if (r > 200 && g < 100 && b > 150) return "vibrant magenta";
  if (r < 80 && g > 150 && b > 150) return "teal";
  if (r > 150 && g > 100 && b < 60) return "warm amber";
  return "neutral";
}

const STYLE_BASES: Record<StyleId, string> = {
  clean_corporate:
    "professional corporate background, clean geometric lines, minimal modern elements, business aesthetic",
  bold_promo:
    "high-contrast promotional background, dynamic diagonal composition, energetic graphic rhythm, bold visual design",
  minimal_modern:
    "minimalist background, generous negative space, single subtle accent element, premium contemporary feel",
  editorial:
    "sophisticated editorial background, layered depth, journalistic composition, muted sophisticated tones",
  product_focus:
    "clean studio background, soft gradient, professional product photography environment, neutral tones",
};

const COMPOSITION_MODIFIERS: Record<CompositionType, string> = {
  split_layout:
    "asymmetric composition — left two-thirds rich, right third light and open for text",
  gradient_fade:
    "gradient from rich left edge fading to light on right — left side clear for text overlay",
  full_background:
    "full-frame background with darker lower third suitable for text",
  geometric:
    "subtle geometric shapes concentrated in upper corners, clear central zone",
  texture:
    "even textured surface, consistent lighting throughout, clear content zone",
};

const INDUSTRY_MODIFIERS: Record<string, string> = {
  "Technology / SaaS": "digital, contemporary, tech aesthetic",
  Technology: "digital, contemporary, tech aesthetic",
  Healthcare: "clean, clinical, trustworthy, soft",
  Finance: "stable, authoritative, precise",
  "Real Estate": "premium, architectural, aspirational",
  Retail: "dynamic, consumer-friendly, vibrant",
  Education: "approachable, structured, inspiring",
  Hospitality: "warm, inviting, luxurious",
  Food: "appetising, rich, warm tones",
  Legal: "authoritative, formal, classic",
};
