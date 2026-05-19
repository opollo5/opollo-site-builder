import "server-only";

import { withHealthMonitoring } from "@/lib/platform/service-health/monitor";
import { logger } from "@/lib/logger";
import type { ImageGenRequest, ImageGenResponse } from "./types";

const IDEOGRAM_API = "https://api.ideogram.ai/generate";
const NEGATIVE_PROMPT = "text, words, letters, typography, watermark, logo, blurry, distorted, low quality";
const TIMEOUT_MS = 30_000;

interface IdeogramApiResponse {
  data: Array<{ url: string }>;
}

export interface IImageProvider {
  generate(req: ImageGenRequest): Promise<ImageGenResponse>;
}

export class IdeogramImageProvider implements IImageProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? process.env.IDEOGRAM_API_KEY ?? "";
    this.model = model ?? process.env.IDEOGRAM_STANDARD_MODEL ?? "ideogram-ai/ideogram-v3-flash";
  }

  async generate(req: ImageGenRequest): Promise<ImageGenResponse> {
    const start = Date.now();

    const url = await withHealthMonitoring("ideogram", "image-gen", async () => {
      const resp = await fetch(IDEOGRAM_API, {
        method: "POST",
        headers: { "Api-Key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_request: {
            prompt: req.prompt,
            model: this.model,
            aspect_ratio: req.aspectRatio ?? "ASPECT_1_1",
            num_images: 1,
            style_type: "REALISTIC",
            negative_prompt: NEGATIVE_PROMPT,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!resp.ok) {
        const body = await resp.text();
        const err = new Error(`Ideogram ${resp.status}: ${body.slice(0, 200)}`);
        (err as NodeJS.ErrnoException).code = String(resp.status);
        throw err;
      }

      const data = (await resp.json()) as IdeogramApiResponse;
      const imageUrl = data.data[0]?.url;
      if (!imageUrl) throw new Error("Ideogram returned no image URL");
      return imageUrl;
    });

    const latencyMs = Date.now() - start;
    logger.info("cap.pal.image-gen", { latencyMs });
    return { url, latencyMs };
  }
}
