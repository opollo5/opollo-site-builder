import "server-only";

import sharp from "sharp";

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

// v3 response: url is always present; width/height may or may not be.
// Dimensions are extracted from the downloaded buffer via sharp — reliable regardless.
interface IdeogramResponseImage {
  url: string;
  width?: number;
  height?: number;
}

interface IdeogramResponse {
  data: IdeogramResponseImage[];
}

// v3 endpoint — always FLASH. Premium routing is out of scope (§3 of brief).
const IDEOGRAM_V3_URL = "https://api.ideogram.ai/v1/ideogram-v3/generate";
const RENDERING_SPEED = "FLASH";

export async function generateBackground(
  params: GenerationParams,
): Promise<GeneratedImage[]> {
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

  // v3 uses multipart/form-data — do NOT set Content-Type manually;
  // fetch sets it with the correct boundary when body is FormData.
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("rendering_speed", RENDERING_SPEED);
  form.append("aspect_ratio", params.aspectRatio); // e.g. "1x1", "16x9"
  form.append("num_images", String(params.count ?? 1));
  form.append("style_type", "REALISTIC");
  form.append("negative_prompt", GLOBAL_NEGATIVE_PROMPT);

  let responseData: IdeogramResponse;
  try {
    const response = await fetch(IDEOGRAM_V3_URL, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: form,
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
      renderingSpeed: RENDERING_SPEED,
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

  // Extract actual dimensions from the buffer — more reliable than API metadata
  // (v3 may omit width/height in the response, and v2 values can mismatch storage).
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? img.width ?? 0;
  const height = metadata.height ?? img.height ?? 0;

  logger.info("Generated image stored", {
    companyId,
    storagePath,
    width,
    height,
    durationMs: Date.now() - downloadStart,
  });

  return {
    storagePath,
    width,
    height,
    format: ext,
    buffer,
  };
}

export function isRetryable(err: IdeogramError): boolean {
  return err.status === 429 || err.status >= 500 || err.status === 0;
}
