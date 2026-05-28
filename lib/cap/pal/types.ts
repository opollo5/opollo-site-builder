export interface TextGenRequest {
  model: string;
  systemMessage: string;
  userMessage: string;
  maxTokens?: number;
}

export interface TextGenResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ImageGenRequest {
  prompt: string;
  aspectRatio?: "1x1" | "16x9" | "4x5";
}

export interface ImageGenResponse {
  url: string;
  latencyMs: number;
}
