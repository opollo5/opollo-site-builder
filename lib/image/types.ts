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

export type AspectRatio =
  | "ASPECT_1_1"
  | "ASPECT_4_5"
  | "ASPECT_16_9"
  | "ASPECT_9_16";

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
