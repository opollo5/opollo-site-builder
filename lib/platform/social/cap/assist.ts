import "server-only";

import { randomUUID } from "crypto";

import {
  RateLimitError,
  APIConnectionTimeoutError,
  APIConnectionError,
  BadRequestError,
} from "@anthropic-ai/sdk";

import { getActiveBrandProfile } from "@/lib/platform/brand/get";
import { logger } from "@/lib/logger";
import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";

// ---------------------------------------------------------------------------
// Spec 22 PR 4 — AI assist for the inline composer panel.
//
// Generates a single post from a user-supplied prompt without creating any
// DB records — text is returned for the user to Replace or Append into
// their draft. Lighter than CAP generate (Haiku model, plain-text output).
// ---------------------------------------------------------------------------

export type AssistTone = "professional" | "casual" | "playful";
export type AssistLength = "short" | "medium" | "long";
export type AssistGoal = "educate" | "promote" | "announce" | "engage";
export type AssistErrorCategory = "rate_limit" | "timeout" | "content_rejected" | "network" | "overloaded" | "unknown";

export interface AssistInput {
  companyId: string;
  prompt: string;
  tone: AssistTone;
  length: AssistLength;
  goal?: AssistGoal;
  requestedBy: string;
}

export type AssistError = {
  category: AssistErrorCategory;
  code: string;
  message: string;
  trace_id: string;
  retry_after?: number;
  can_retry: boolean;
};

export type AssistResult =
  | { ok: true; text: string }
  | { ok: false; error: AssistError };

const TONE_GUIDE: Record<AssistTone, string> = {
  professional:
    "Use a professional, authoritative tone. Clear, confident, jargon-free language.",
  casual:
    "Use a conversational, friendly tone. Approachable and relatable — like talking to a colleague.",
  playful:
    "Use a light, fun, energetic tone. Emojis are welcome if they fit naturally.",
};

const LENGTH_GUIDE: Record<AssistLength, string> = {
  short: "Keep it brief — 1–2 sentences, around 30–60 words maximum.",
  medium: "Aim for 2–4 sentences, around 80–150 words.",
  long: "Write a fuller post — 4–8 sentences, around 180–280 words.",
};

const GOAL_GUIDE: Record<AssistGoal, string> = {
  educate:  "Focus on teaching the audience something valuable. Lead with insight.",
  promote:  "Highlight a product, service, or offer. Drive action with a clear CTA.",
  announce: "Share news or a milestone. Be direct and clear about what happened.",
  engage:   "Spark a conversation. Ask a question or invite opinions.",
};

function generateTraceId(): string {
  const hex = randomUUID().replace(/-/g, "");
  return `ai-gen-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function categorizeError(err: unknown): Omit<AssistError, "trace_id"> {
  if (err instanceof RateLimitError) {
    const headers = (err as unknown as { headers?: Headers }).headers;
    const retryAfterHeader = headers instanceof Headers ? headers.get("retry-after") : null;
    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
    return {
      category: "rate_limit",
      code: "RATE_LIMIT",
      message: `You hit the per-minute token limit. Try again in ${retryAfter}s.`,
      retry_after: isNaN(retryAfter) ? 60 : retryAfter,
      can_retry: true,
    };
  }

  if (err instanceof APIConnectionTimeoutError) {
    return {
      category: "timeout",
      code: "TIMEOUT",
      message: "Generation timed out. Try shortening your prompt.",
      can_retry: true,
    };
  }

  if (err instanceof APIConnectionError) {
    return {
      category: "network",
      code: "NETWORK_ERROR",
      message: "Network error connecting to AI service. Check your connection.",
      can_retry: true,
    };
  }

  if (err instanceof BadRequestError) {
    return {
      category: "content_rejected",
      code: "CONTENT_REJECTED",
      message: "The prompt was rejected. Please review your content and try again.",
      can_retry: false,
    };
  }

  // HTTP 529 (overloaded) — InternalServerError with status 529
  const status = (err as { status?: number }).status;
  if (status === 529) {
    return {
      category: "overloaded",
      code: "MODEL_OVERLOADED",
      message: "The AI model is temporarily busy. Retrying automatically…",
      can_retry: true,
    };
  }

  return {
    category: "unknown",
    code: "CLAUDE_ERROR",
    message: "Failed to generate text. Please try again.",
    can_retry: true,
  };
}

export async function generateAssistText(
  input: AssistInput,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<AssistResult> {
  const { companyId, prompt, tone, length, goal, requestedBy } = input;

  const brand = await getActiveBrandProfile(companyId);

  const systemParts: string[] = [
    "You are a social media copywriter. Write a single social media post based on the user's instructions.",
    "Return ONLY the post text — no quotes around it, no markdown, no preamble, no explanations.",
  ];

  if (brand) {
    if (brand.personality_traits.length > 0) {
      systemParts.push(`Brand personality: ${brand.personality_traits.join(", ")}.`);
    }
    if (brand.avoided_terms.length > 0) {
      systemParts.push(`Never use these words or phrases: ${brand.avoided_terms.join(", ")}.`);
    }
    if (brand.content_restrictions.length > 0) {
      systemParts.push(`Hard content rules (never violate): ${brand.content_restrictions.join(". ")}.`);
    }
  }

  if (goal) systemParts.push(`Goal: ${GOAL_GUIDE[goal]}`);
  systemParts.push(`Tone instruction: ${TONE_GUIDE[tone]}`);
  systemParts.push(`Length instruction: ${LENGTH_GUIDE[length]}`);

  const system = systemParts.join("\n");

  logger.info("cap.assist.start", { companyId, tone, length, goal: goal ?? null, requestedBy });

  let rawText: string;
  try {
    const resp = await callFn({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: `Write a social media post about: ${prompt}` }],
      idempotency_key: randomUUID(),
    });
    rawText = resp.content.map((b) => b.text).join("").trim();
  } catch (err) {
    const traceId = generateTraceId();
    const categorized = categorizeError(err);
    logger.error("cap.assist.claude_failed", {
      companyId,
      traceId,
      category: categorized.category,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: { ...categorized, trace_id: traceId } };
  }

  if (!rawText) {
    return {
      ok: false,
      error: {
        category: "unknown",
        code: "EMPTY_RESPONSE",
        message: "No text was generated. Please try again.",
        trace_id: generateTraceId(),
        can_retry: true,
      },
    };
  }

  logger.info("cap.assist.done", { companyId, chars: rawText.length });
  return { ok: true, text: rawText };
}
