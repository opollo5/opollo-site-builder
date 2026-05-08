import "server-only";

import { randomUUID } from "crypto";

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

export interface AssistInput {
  companyId: string;
  prompt: string;
  tone: AssistTone;
  length: AssistLength;
  requestedBy: string;
}

export type AssistResult =
  | { ok: true; text: string }
  | { ok: false; error: { code: string; message: string } };

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

export async function generateAssistText(
  input: AssistInput,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<AssistResult> {
  const { companyId, prompt, tone, length, requestedBy } = input;

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

  systemParts.push(`Tone instruction: ${TONE_GUIDE[tone]}`);
  systemParts.push(`Length instruction: ${LENGTH_GUIDE[length]}`);

  const system = systemParts.join("\n");

  logger.info("cap.assist.start", { companyId, tone, length, requestedBy });

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
    logger.error("cap.assist.claude_failed", {
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: { code: "CLAUDE_ERROR", message: "Failed to generate text. Please try again." },
    };
  }

  if (!rawText) {
    return {
      ok: false,
      error: { code: "EMPTY_RESPONSE", message: "No text was generated. Please try again." },
    };
  }

  logger.info("cap.assist.done", { companyId, chars: rawText.length });
  return { ok: true, text: rawText };
}
