import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { getImageProvider } from "@/lib/cap/pal";
import { calculateIdeogramCost } from "@/lib/cap/pal/cost-tracker";
import { buildImagePrompt, IMAGE_PROMPT_VERSION } from "@/lib/cap/prompts/image-prompt";

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

const IMAGE_MODEL = "V_2_TURBO";

export async function generateImageForPost(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  const { campaignId, postId, arcPhase, industry, postContent } = input;

  const prompt = buildImagePrompt({
    arcPhase,
    industry,
    postContentSummary: postContent,
  });

  const provider = getImageProvider();
  let genResult;
  let status: "success" | "error" = "success";
  let errorDetails: Record<string, unknown> | null = null;

  try {
    genResult = await provider.generate({ prompt });
  } catch (err) {
    status = "error";
    errorDetails = { message: err instanceof Error ? err.message : String(err) };
    await recordImageRun({ postId, campaignId, prompt, status, errorDetails });
    throw err;
  }

  await recordImageRun({
    postId,
    campaignId,
    prompt,
    estimatedCostUsd: calculateIdeogramCost(),
    latencyMs: genResult.latencyMs,
    status,
  });

  return {
    url: genResult.url,
    costUsd: calculateIdeogramCost(),
    latencyMs: genResult.latencyMs,
  };
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
    model: IMAGE_MODEL,
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
