import "server-only";

import { randomUUID } from "crypto";

import { getActiveBrandProfile } from "@/lib/platform/brand/get";
import { logger } from "@/lib/logger";
import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { getServiceRoleClient } from "@/lib/supabase";
import { SUPPORTED_PLATFORMS } from "@/lib/platform/social/variants/types";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

import {
  buildSystemPrompt,
  buildUserPrompt,
  PLATFORM_CHAR_LIMITS,
} from "./prompt-builder";
import { triggerCAPImageGen } from "./image-trigger";
import type {
  CAPClaudeResponse,
  CAPGenerateInput,
  CAPGenerateResult,
  CAPGeneratedPost,
} from "./types";

// ---------------------------------------------------------------------------
// D1 — CAP copy generator (V2).
//
// Reads the company's active brand profile → builds prompts → calls Claude
// → parses structured JSON response → inserts social_post_drafts rows with
// source_type='cap' + platform_variants JSONB (one entry per platform).
//
// AnthropicCallFn is dependency-injected (default = defaultAnthropicCall)
// so unit tests substitute a stub without real API credentials.
// ---------------------------------------------------------------------------

const CAP_MODEL = "claude-sonnet-4-6";
const CAP_MAX_TOKENS = 4096;
const MAX_COUNT = 5;
const MIN_COUNT = 1;

function clampCount(n: number | undefined): number {
  if (!n || n < MIN_COUNT) return 3;
  return Math.min(n, MAX_COUNT);
}

function resolvePlatforms(platforms: SocialPlatform[] | undefined): SocialPlatform[] {
  if (!platforms || platforms.length === 0) return [...SUPPORTED_PLATFORMS];
  return platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p));
}

function truncateToLimit(text: string, platform: SocialPlatform): string {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1) + "…";
}

function parseClaudeResponse(raw: string): CAPClaudeResponse | null {
  const trimmed = raw.trim();
  // Strip markdown fences if Claude adds them despite instructions.
  const unwrapped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(unwrapped) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).posts)
    ) {
      return null;
    }
    return parsed as CAPClaudeResponse;
  } catch {
    return null;
  }
}

export async function generateCAPPosts(
  input: CAPGenerateInput,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<CAPGenerateResult> {
  const { companyId, topics = [], triggeredBy } = input;
  const count = clampCount(input.count);
  const platforms = resolvePlatforms(input.platforms);

  if (platforms.length === 0) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "No valid platforms specified." } };
  }

  // Read brand profile — gracefully degrade to defaults if none set.
  const brand = await getActiveBrandProfile(companyId);

  const systemPrompt = buildSystemPrompt(brand, platforms);
  const userPrompt = buildUserPrompt(brand, topics, count);

  logger.info("cap.generate.start", { companyId, count, platforms, hasBrand: !!brand });

  let rawResponse: string;
  try {
    const resp = await callFn({
      model: CAP_MODEL,
      max_tokens: CAP_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      idempotency_key: randomUUID(),
    });
    rawResponse = resp.content.map((b) => b.text).join("");
  } catch (err) {
    logger.error("cap.generate.claude_failed", {
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: { code: "CLAUDE_ERROR", message: "Failed to call Claude for copy generation." } };
  }

  const parsed = parseClaudeResponse(rawResponse);
  if (!parsed || parsed.posts.length === 0) {
    logger.error("cap.generate.parse_failed", { companyId, rawLength: rawResponse.length });
    return { ok: false, error: { code: "PARSE_FAILED", message: "Claude response could not be parsed as valid JSON." } };
  }

  const created: CAPGeneratedPost[] = [];
  const svc = getServiceRoleClient();

  for (const post of parsed.posts.slice(0, count)) {
    const masterText = post.master_text?.trim() ?? "";
    if (!masterText) continue;

    // Build platform_variants JSONB in one pass before the DB insert.
    const platformVariants: Record<string, { content: string }> = {};
    const variantMap: Partial<Record<SocialPlatform, string>> = {};
    for (const platform of platforms) {
      const raw = post.variants?.[platform];
      if (!raw?.trim()) continue;
      const text = truncateToLimit(raw.trim(), platform);
      platformVariants[platform] = { content: text };
      variantMap[platform] = text;
    }

    const { data: draft, error: draftErr } = await svc
      .from("social_post_drafts")
      .insert({
        company_id:        companyId,
        created_by:        triggeredBy,
        updated_by:        triggeredBy,
        content:           masterText,
        source_type:       "cap",
        state:             "draft",
        media_urls:        [],
        target_profiles:   [],
        platform_variants: platformVariants,
      })
      .select("id")
      .single();

    if (draftErr || !draft?.id) {
      logger.error("cap.generate.post_create_failed", {
        companyId,
        err: draftErr?.message,
      });
      continue;
    }

    const draftId = draft.id as string;
    created.push({ draftId, masterText, variants: variantMap });

    // I5 — fire-and-forget image generation.
    void triggerCAPImageGen({ companyId, draftId, brand });
  }

  if (created.length === 0) {
    return { ok: false, error: { code: "ALL_FAILED", message: "All posts failed to create." } };
  }

  logger.info("cap.generate.done", { companyId, created: created.length });
  return { ok: true, posts: created };
}
