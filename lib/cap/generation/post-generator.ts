import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import { getTextProvider } from "@/lib/cap/pal";
import { calculateAnthropicCost } from "@/lib/cap/pal/cost-tracker";
import { sanitizePromptInput, sanitizePromptArray } from "@/lib/cap/generation/sanitize";
import {
  PROMPT_VERSION,
  buildCampaignPostSystemMessage,
  buildCampaignPostUserMessage,
} from "@/lib/cap/prompts/campaign-post";

export interface GeneratePostInput {
  campaignId: string;
  postId: string;
  weekNumber: 1 | 2 | 3 | 4;
  arcPhase: "awareness" | "education" | "offer" | "proof";
  monthlyObjective: string;
  month: string;
  voiceProfile: {
    tone: string;
    industry: string;
    targetAudience: string;
    bannedWords: string[];
    onBrandPhrases: string[];
    languagePatterns: Record<string, unknown>;
    referencePosts: string[];
  };
}

export interface GeneratePostResult {
  content: string;
  hashtags: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function generatePost(input: GeneratePostInput): Promise<GeneratePostResult> {
  const {
    campaignId,
    postId,
    weekNumber,
    arcPhase,
    monthlyObjective,
    month,
    voiceProfile,
  } = input;

  const sanitizedObjective = sanitizePromptInput(monthlyObjective);
  const sanitizedBanned = sanitizePromptArray(voiceProfile.bannedWords);
  const sanitizedOnBrand = sanitizePromptArray(voiceProfile.onBrandPhrases);
  const sanitizedRefs = sanitizePromptArray(voiceProfile.referencePosts);
  const sanitizedIndustry = sanitizePromptInput(voiceProfile.industry);
  const sanitizedAudience = sanitizePromptInput(voiceProfile.targetAudience);

  const systemMessage = buildCampaignPostSystemMessage();
  const userMessage = buildCampaignPostUserMessage({
    weekNumber,
    arcPhase,
    monthlyObjective: sanitizedObjective,
    month,
    tone: voiceProfile.tone,
    industry: sanitizedIndustry,
    targetAudience: sanitizedAudience,
    bannedWords: sanitizedBanned,
    onBrandPhrases: sanitizedOnBrand,
    languagePatterns: voiceProfile.languagePatterns,
    referencePosts: sanitizedRefs,
  });

  const provider = getTextProvider();
  let genResult;
  let status: "success" | "error" = "success";
  let errorDetails: Record<string, unknown> | null = null;

  try {
    genResult = await provider.generate({
      model: DEFAULT_MODEL,
      systemMessage,
      userMessage,
    });
  } catch (err) {
    status = "error";
    errorDetails = { message: err instanceof Error ? err.message : String(err) };
    await recordGenerationRun({
      postId,
      campaignId,
      operation: "text_generation",
      promptVersion: PROMPT_VERSION,
      promptUsed: userMessage,
      model: DEFAULT_MODEL,
      status,
      errorDetails,
    });
    throw err;
  }

  const costUsd = calculateAnthropicCost(
    DEFAULT_MODEL,
    genResult.inputTokens,
    genResult.outputTokens,
  );

  await recordGenerationRun({
    postId,
    campaignId,
    operation: "text_generation",
    promptVersion: PROMPT_VERSION,
    promptUsed: userMessage,
    model: DEFAULT_MODEL,
    inputTokens: genResult.inputTokens,
    outputTokens: genResult.outputTokens,
    estimatedCostUsd: costUsd,
    latencyMs: genResult.latencyMs,
    status,
  });

  // Parse JSON response from the model
  let content: string;
  let hashtags: string[];

  try {
    const parsed = JSON.parse(genResult.text) as { content?: string; hashtags?: string[] };
    if (!parsed.content || typeof parsed.content !== "string") {
      throw new Error("missing content field in model response");
    }
    content = parsed.content;
    hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.filter((h): h is string => typeof h === "string").slice(0, 10)
      : [];
  } catch (parseErr) {
    logger.warn("cap.post-generator.parse_failed", {
      postId,
      raw: genResult.text.slice(0, 200),
      error: parseErr instanceof Error ? parseErr.message : String(parseErr),
    });
    // Treat the raw text as content with no hashtags — still usable by reviewers
    content = genResult.text;
    hashtags = [];
  }

  return {
    content,
    hashtags,
    inputTokens: genResult.inputTokens,
    outputTokens: genResult.outputTokens,
    costUsd,
    latencyMs: genResult.latencyMs,
  };
}

interface RecordRunInput {
  postId: string;
  campaignId: string;
  operation: "text_generation" | "image_generation" | "full_campaign";
  promptVersion: number;
  promptUsed: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  status: "success" | "error";
  errorDetails?: Record<string, unknown> | null;
}

async function recordGenerationRun(input: RecordRunInput): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("cap_generation_runs").insert({
    cap_campaign_post_id: input.postId,
    cap_campaign_id: input.campaignId,
    operation: input.operation,
    prompt_version: input.promptVersion,
    prompt_used: input.promptUsed,
    model: input.model,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    estimated_cost_usd: input.estimatedCostUsd ?? 0,
    latency_ms: input.latencyMs ?? null,
    status: input.status,
    error_details: input.errorDetails ?? null,
  });
  if (error) {
    logger.warn("cap.post-generator.run_record_failed", { error: error.message });
  }
}
