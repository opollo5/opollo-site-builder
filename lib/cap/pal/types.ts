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
  aspectRatio?: "ASPECT_1_1" | "ASPECT_16_9" | "ASPECT_4_5";
}

export interface ImageGenResponse {
  url: string;
  latencyMs: number;
}
