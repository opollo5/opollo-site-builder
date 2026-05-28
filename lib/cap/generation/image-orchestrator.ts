import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { calculateIdeogramCost } from "@/lib/cap/pal/cost-tracker";
import { buildImagePrompt, IMAGE_PROMPT_VERSION } from "@/lib/cap/prompts/image-prompt";

// ---------------------------------------------------------------------------
// CAP Phase 1 campaign image generation.
//
// This path uses free-form prompts built from campaign context and records
// to cap_generation_runs (not image_generation_log). It is separate from the
// social image generation pipeline (lib/image/failure/handler.ts) which uses
// parameterised prompts and writes to image_generation_log.
//
// The old IdeogramImageProvider class (lib/cap/pal/image-provider.ts) was
// removed in A3. This module now calls the v3 endpoint directly so the
// image-provider abstraction layer is not needed for this code path.
// ---------------------------------------------------------------------------

export interface GenerateImageInput {
  campaignId: string;
  postId: string;
  arcPhase: "awareness" | "education" | "offer" | "proof";
  industry: string;
  postContent: string;
}

export interface GenerateImageResult {
  url: string;
  costUsd: number;
  latencyMs: number;
}

const IDEOGRAM_V3_URL = "https://api.ideogram.ai/v1/ideogram-v3/generate";
const NEGATIVE_PROMPT =
  "text, words, letters, typography, watermark, logo, blurry, distorted, low quality";

export async function generateImageForPost(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const { campaignId, postId, arcPhase, industry, postContent } = input;

  const prompt = buildImagePrompt({ arcPhase, industry, postContentSummary: postContent });

  const apiKey = process.env.IDEOGRAM_API_KEY ?? "";
  const start = Date.now();
  let url: string;
  let status: "success" | "error" = "success";
  let errorDetails: Record<string, unknown> | null = null;

  try {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("rendering_speed", "FLASH");
    form.append("aspect_ratio", "1x1"); // CAP campaigns default to square
    form.append("num_images", "1");
    form.append("style_type", "REALISTIC");
    form.append("negative_prompt", NEGATIVE_PROMPT);

    const resp = await fetch(IDEOGRAM_V3_URL, {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: form,
      signal: AbortSignal.timeout(
        parseInt(process.env.IMAGE_GENERATION_TIMEOUT_MS ?? "30000"),
      ),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Ideogram ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { data: Array<{ url: string }> };
    const imageUrl = data.data[0]?.url;
    if (!imageUrl) throw new Error("Ideogram returned no image URL");
    url = imageUrl;
  } catch (err) {
    status = "error";
    errorDetails = { message: err instanceof Error ? err.message : String(err) };
    await recordImageRun({ postId, campaignId, prompt, status, errorDetails });
    throw err;
  }

  const latencyMs = Date.now() - start;
  logger.info("cap.image-orchestrator.generated", { campaignId, postId, latencyMs });

  await recordImageRun({
    postId,
    campaignId,
    prompt,
    estimatedCostUsd: calculateIdeogramCost(),
    latencyMs,
    status,
  });

  return { url, costUsd: calculateIdeogramCost(), latencyMs };
}

interface RecordImageRunInput {
  postId: string;
  campaignId: string;
  prompt: string;
  estimatedCostUsd?: number;
  latencyMs?: number;
  status: "success" | "error";
  errorDetails?: Record<string, unknown> | null;
}

async function recordImageRun(input: RecordImageRunInput): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("cap_generation_runs").insert({
    cap_campaign_post_id: input.postId,
    cap_campaign_id: input.campaignId,
    operation: "image_generation",
    prompt_version: IMAGE_PROMPT_VERSION,
    prompt_used: input.prompt,
    model: "ideogram-v3-flash",
    input_tokens: null,
    output_tokens: null,
    estimated_cost_usd: input.estimatedCostUsd ?? 0,
    latency_ms: input.latencyMs ?? null,
    status: input.status,
    error_details: input.errorDetails ?? null,
  });
  if (error) {
    logger.warn("cap.image-orchestrator.run_record_failed", { error: error.message });
  }
}
