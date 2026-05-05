import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { GeneratedImage, GenerationParams } from "../types";
import { IdeogramError } from "../types";
import { buildPrompt } from "./prompt-engine";

const GLOBAL_NEGATIVE_PROMPT = [
  "text",
  "words",
  "letters",
  "typography",
  "watermark",
  "logo",
  "signature",
  "caption",
  "label",
  "title",
  "heading",
  "font",
  "written",
  "blurry",
  "distorted",
  "low quality",
  "pixelated",
  "noisy",
].join(", ");

const IMAGE_GEN_BUCKET =
  process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";

interface IdeogramResponseImage {
  url: string;
  width: number;
  height: number;
}

interface IdeogramResponse {
  data: IdeogramResponseImage[];
}

export async function generateBackground(
  params: GenerationParams,
): Promise<GeneratedImage[]> {
  const model =
    params.model === "premium"
      ? (process.env.IDEOGRAM_PREMIUM_MODEL ?? "ideogram-ai/ideogram-v3")
      : (process.env.IDEOGRAM_STANDARD_MODEL ??
          "ideogram-ai/ideogram-v3-flash");

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    throw new IdeogramError(0, "IDEOGRAM_API_KEY is not set");
  }

  const prompt = buildPrompt({
    styleId: params.styleId,
    primaryColour: params.primaryColour,
    compositionType: params.compositionType,
    industry: params.industry,
    mood: params.mood,
    safeMode: false, // safe_mode gates styles in routing.ts; prompt simplification is separate
    simplify: params.simplifyPrompt,
  });

  const startMs = Date.now();

  let responseData: IdeogramResponse;
  try {
    const response = await fetch("https://api.ideogram.ai/generate", {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_request: {
          prompt,
          model,
          aspect_ratio: params.aspectRatio,
          num_images: params.count ?? 1,
          style_type: "REALISTIC",
          negative_prompt: GLOBAL_NEGATIVE_PROMPT,
        },
      }),
      signal: AbortSignal.timeout(
        parseInt(process.env.IMAGE_GENERATION_TIMEOUT_MS ?? "30000"),
      ),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("Ideogram API error", {
        status: response.status,
        styleId: params.styleId,
        companyId: params.companyId,
      });
      throw new IdeogramError(response.status, body);
    }

    responseData = (await response.json()) as IdeogramResponse;
    logger.info("Ideogram generation success", {
      model,
      styleId: params.styleId,
      count: responseData.data.length,
      durationMs: Date.now() - startMs,
      companyId: params.companyId,
    });
  } catch (err) {
    if (err instanceof IdeogramError) throw err;
    logger.error("Ideogram request failed", {
      error: String(err),
      companyId: params.companyId,
    });
    throw new IdeogramError(0, String(err));
  }

  // Download immediately — Ideogram URLs are ephemeral
  return Promise.all(
    responseData.data.map((img) =>
      downloadAndStore(img, params.companyId, prompt),
    ),
  );
}

async function downloadAndStore(
  img: IdeogramResponseImage,
  companyId: string,
  _prompt: string,
): Promise<GeneratedImage> {
  const downloadStart = Date.now();

  const dlResponse = await fetch(img.url);
  if (!dlResponse.ok) {
    throw new IdeogramError(dlResponse.status, "Failed to download Ideogram image");
  }

  const arrayBuffer = await dlResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const contentType = dlResponse.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpeg";
  const storagePath = `${companyId}/generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const supabase = getServiceRoleClient();
  const { error } = await supabase.storage
    .from(IMAGE_GEN_BUCKET)
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    logger.error("Failed to upload generated image to storage", {
      companyId,
      storagePath,
      error: error.message,
    });
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  logger.info("Generated image stored", {
    companyId,
    storagePath,
    durationMs: Date.now() - downloadStart,
  });

  return {
    storagePath,
    width: img.width,
    height: img.height,
    format: ext,
    buffer,
  };
}

export function isRetryable(err: IdeogramError): boolean {
  return err.status === 429 || err.status >= 500 || err.status === 0;
}
