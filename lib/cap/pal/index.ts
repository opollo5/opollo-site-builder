import "server-only";

import { AnthropicTextProvider } from "./text-provider";
import type { ITextProvider } from "./text-provider";

export { AnthropicTextProvider } from "./text-provider";
export { calculateAnthropicCost, calculateIdeogramCost } from "./cost-tracker";
export type { ITextProvider } from "./text-provider";
export type { TextGenRequest, TextGenResponse } from "./types";

let _textProvider: ITextProvider | null = null;

export function getTextProvider(): ITextProvider {
  if (!_textProvider) _textProvider = new AnthropicTextProvider();
  return _textProvider;
}
