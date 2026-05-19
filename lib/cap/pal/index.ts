import "server-only";

import { AnthropicTextProvider } from "./text-provider";
import { IdeogramImageProvider } from "./image-provider";
import type { ITextProvider } from "./text-provider";
import type { IImageProvider } from "./image-provider";

export { AnthropicTextProvider } from "./text-provider";
export { IdeogramImageProvider } from "./image-provider";
export { calculateAnthropicCost, calculateIdeogramCost } from "./cost-tracker";
export type { ITextProvider } from "./text-provider";
export type { IImageProvider } from "./image-provider";
export type { TextGenRequest, TextGenResponse, ImageGenRequest, ImageGenResponse } from "./types";

let _textProvider: ITextProvider | null = null;
let _imageProvider: IImageProvider | null = null;

export function getTextProvider(): ITextProvider {
  if (!_textProvider) _textProvider = new AnthropicTextProvider();
  return _textProvider;
}

export function getImageProvider(): IImageProvider {
  if (!_imageProvider) _imageProvider = new IdeogramImageProvider();
  return _imageProvider;
}

/** Inject providers for testing. */
export function setProviders(text: ITextProvider, image: IImageProvider): void {
  _textProvider = text;
  _imageProvider = image;
}

/** Reset to real providers (call in afterEach in tests). */
export function resetProviders(): void {
  _textProvider = null;
  _imageProvider = null;
}
