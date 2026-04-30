// DESIGN-DISCOVERY — industry presets.
//
// Pre-loaded defaults keyed by industry. Applied client-side when the
// operator picks an industry from the input surface so the mood board
// has something to render before they paste a URL or upload a sample.
// Each preset gets overridden by stronger signals (URL extraction,
// screenshot vision pass) when those land.

export type Industry =
  | "msp"
  | "it_services"
  | "cybersecurity"
  | "general_b2b"
  | "other";

export interface IndustryPreset {
  label: string;
  visual_tone: string;
  layout_tags: string[];
  visual_tone_tags: string[];
  // Five-swatch palette: primary / secondary / accent / background / text.
  swatches: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  font_heading: string;
  font_body: string;
  // Default tone-of-voice nudge — used in the next step when the
  // operator pastes no URL and writes nothing.
  default_voice_seed: string;
}

export const INDUSTRY_PRESETS: Record<Industry, IndustryPreset> = {
  msp: {
    label: "MSP",
    visual_tone: "Premium, technical, trustworthy",
    layout_tags: ["Full-width hero", "Card grid", "Clean whitespace"],
    visual_tone_tags: ["Premium", "Technical", "Trustworthy"],
    swatches: {
      primary: "#0F172A",
      secondary: "#475569",
      accent: "#3B82F6",
      background: "#FFFFFF",
      text: "#0F172A",
    },
    font_heading: "Inter",
    font_body: "Inter",
    default_voice_seed:
      "Professional, straight-talking, technical when needed but never jargon-heavy. Speaks to business owners running their own IT operation.",
  },
  it_services: {
    label: "IT Services",
    visual_tone: "Approachable, professional, modern",
    layout_tags: ["Hero with CTA", "Service tiles", "Testimonial band"],
    visual_tone_tags: ["Approachable", "Professional", "Modern"],
    swatches: {
      primary: "#111827",
      secondary: "#4B5563",
      accent: "#2563EB",
      background: "#F9FAFB",
      text: "#111827",
    },
    font_heading: "Inter",
    font_body: "Inter",
    default_voice_seed:
      "Friendly, professional, outcome-focused. Lead with business outcomes; keep technical detail in service descriptions.",
  },
  cybersecurity: {
    label: "Cybersecurity",
    visual_tone: "Authoritative, modern, dark accents",
    layout_tags: ["Dark theme", "Dense data", "Hero with stats"],
    visual_tone_tags: ["Authoritative", "Premium", "Technical"],
    swatches: {
      primary: "#0B1220",
      secondary: "#1F2937",
      accent: "#22D3EE",
      background: "#0B1220",
      text: "#E5E7EB",
    },
    font_heading: "IBM Plex Sans",
    font_body: "Inter",
    default_voice_seed:
      "Authoritative, calm, evidence-based. Avoid fear-based copy; lead with concrete capabilities and outcomes.",
  },
  general_b2b: {
    label: "General B2B",
    visual_tone: "Clean, modern, conversion-focused",
    layout_tags: ["Hero with CTA", "Feature grid", "Logo bar"],
    visual_tone_tags: ["Modern", "Clear", "Conversion-focused"],
    swatches: {
      primary: "#1E293B",
      secondary: "#64748B",
      accent: "#6366F1",
      background: "#FFFFFF",
      text: "#0F172A",
    },
    font_heading: "Inter",
    font_body: "Inter",
    default_voice_seed:
      "Professional, clear, action-oriented. Sentences under 20 words; lead each section with a benefit.",
  },
  other: {
    label: "Other",
    visual_tone: "Modern, flexible, neutral",
    layout_tags: ["Hero", "Content sections", "CTA band"],
    visual_tone_tags: ["Modern", "Neutral"],
    swatches: {
      primary: "#1E293B",
      secondary: "#64748B",
      accent: "#3B82F6",
      background: "#FFFFFF",
      text: "#0F172A",
    },
    font_heading: "Inter",
    font_body: "Inter",
    default_voice_seed:
      "Professional, clear, friendly. Avoid jargon; lead with outcomes.",
  },
};

export function industryPreset(input: string | null | undefined): IndustryPreset {
  if (!input) return INDUSTRY_PRESETS.other;
  if ((INDUSTRY_PRESETS as Record<string, IndustryPreset>)[input]) {
    return INDUSTRY_PRESETS[input as Industry];
  }
  return INDUSTRY_PRESETS.other;
}
