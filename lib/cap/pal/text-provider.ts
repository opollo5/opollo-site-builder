import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { withHealthMonitoring } from "@/lib/platform/service-health/monitor";
import { logger } from "@/lib/logger";
import type { TextGenRequest, TextGenResponse } from "./types";

export interface ITextProvider {
  generate(req: TextGenRequest): Promise<TextGenResponse>;
}

export class AnthropicTextProvider implements ITextProvider {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async generate(req: TextGenRequest): Promise<TextGenResponse> {
    const start = Date.now();

    const response = await withHealthMonitoring("anthropic", "text-gen", async () => {
      const resp = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.systemMessage,
        messages: [{ role: "user", content: req.userMessage }],
      });
      return resp;
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const latencyMs = Date.now() - start;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    logger.info("cap.pal.text-gen", { model: req.model, inputTokens, outputTokens, latencyMs });

    return { text, inputTokens, outputTokens, latencyMs };
  }
}
