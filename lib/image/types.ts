// Core types for the Opollo image generation pipeline.
// All lib/image/ code imports from here — never re-declare these.

export type StyleId =
  | "clean_corporate"
  | "bold_promo"
  | "minimal_modern"
  | "editorial"
  | "product_focus";

export type CompositionType =
  | "split_layout"
  | "gradient_fade"
  | "full_background"
  | "geometric"
  | "texture";

// Ideogram v3 native aspect-ratio strings (sent verbatim in the API request).
// Per §1.1 of the mass-image-gen brief — do not invent new values.
export type AspectRatio = "1x1" | "4x5" | "9x16" | "16x9" | "4x3";

// Platform → Ideogram v3 aspect ratio, per §1.1.
// One image job is generated per distinct ratio derived from target_platforms.
export const MASS_GEN_PLATFORM_MAP: Record<string, AspectRatio> = {
  linkedin: "1x1",
  linkedin_landscape: "16x9",
  instagram: "4x5",
  instagram_story: "9x16",
  facebook: "1x1",
  facebook_story: "9x16",
  x: "16x9",
  gbp: "4x3",
};

export type ModelTier = "standard" | "premium";

// Must stay in sync with the image_gen_outcome enum in migration 0074.
export type ImageGenOutcome =
  | "success"
  | "retry_success"
  | "stock_fallback"
  | "escalated"
  | "failed";

// A single generated image after download from Ideogram and storage in
// Supabase Storage. `storagePath` is the permanent path; the Ideogram
// URL is never stored (it's ephemeral).
export interface GeneratedImage {
  storagePath: string;
  width: number;
  height: number;
  format: string;
  buffer?: Buffer; // present only during the generation pipeline; not persisted
}

export interface GenerationParams {
  styleId: StyleId;
  primaryColour: string;
  compositionType: CompositionType;
  aspectRatio: AspectRatio;
  model?: ModelTier;
  count?: number;
  industry?: string;
  mood?: string;
  companyId: string;
  brandProfileId?: string;
  brandProfileVersion?: number;
  postMasterId?: string;
  triggeredBy?: string;
  simplifyPrompt?: boolean;
}

export class IdeogramError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Ideogram API error ${status}: ${body.slice(0, 200)}`);
    this.name = "IdeogramError";
  }
}

export class StyleBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleBlockedError";
  }
}

export class StockUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockUnavailableError";
  }
}

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}
