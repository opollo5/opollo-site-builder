// Public surface for lib/image. Outside callers import from "@/lib/image".
// Compositing internals (compositeImage, TEXT_ZONE_MAP, etc.) are re-exported
// via @/lib/image/compositing for the I2 compositing layer.

export { generateWithFallback } from "./failure/handler";
export { getAllowedStyles, selectModelTier, validateStyleForBrand } from "./generator/routing";
export { buildPrompt } from "./generator/prompt-engine";
export type {
  AspectRatio,
  CompositionType,
  GeneratedImage,
  GenerationParams,
  ImageGenOutcome,
  ModelTier,
  StyleId,
} from "./types";
export {
  IdeogramError,
  ImageGenerationError,
  StockUnavailableError,
  StyleBlockedError,
} from "./types";
