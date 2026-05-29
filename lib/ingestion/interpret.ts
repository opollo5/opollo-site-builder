import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { defaultAnthropicCall, type AnthropicCallFn } from "@/lib/anthropic-call";
import { getActiveBrandProfile } from "@/lib/platform/brand/get";
import { logger } from "@/lib/logger";
import {
  MASS_GEN_PLATFORM_MAP,
  type AspectRatio,
  type CompositionType,
  type StyleId,
} from "@/lib/image/types";

import {
  STYLE_HINT_VALUES,
  COMPOSITION_HINT_VALUES,
  type PostRow,
} from "./xlsx-parse";

// ---------------------------------------------------------------------------
// C3 — AI interpretation layer.
//
// §C3 of MASS_IMAGE_GEN_BUILD_BRIEF. Given parsed PostRow[] (from C1 or C2)
// and the company's brand profile, calls Claude to produce structured
// (post_text, image_brief) pairs ready for the batch dispatch endpoint
// (B2/B3) to enqueue.
//
// Determinism contract:
//   - aspect_ratios are derived from target_platforms via MASS_GEN_PLATFORM_MAP
//     (deduped) — NOT something the AI picks. Per §1.1.
//   - target_platforms pass through verbatim (already validated by the parser).
//   - headline_text is taken from the row verbatim (the parser enforces this is
//     non-empty); if a future caller drops the constraint, the AI generates a
//     replacement from body_text capped at PLATFORM_CHAR_LIMITS.
//   - style_id, composition_type, primary_colour are chosen by the AI within
//     the constraints of the brand profile + row hints.
//   - All chosen values are validated against the canonical enum sets — any
//     out-of-set value is a hard error.
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

// Per-platform char limit for headline text overlays. Loose v1 default — the
// composite renderer also enforces template-specific max font size.
const HEADLINE_CHAR_LIMIT_PER_PLATFORM = 200;

export interface InterpretInput {
  companyId: string;
  posts: PostRow[];
  /** Override for tests; default uses real Anthropic SDK. */
  anthropicCall?: AnthropicCallFn;
}

export interface ImageBrief {
  style_id: StyleId;
  composition_type: CompositionType;
  primary_colour: string; // hex (#RRGGBB)
  headline_text: string;
  aspect_ratios: AspectRatio[];
  target_platforms: string[];
}

export interface InterpretedPost {
  sourceRow: number;
  post_text: string;
  image_brief: ImageBrief;
}

export type InterpretResult =
  | { ok: true; posts: InterpretedPost[] }
  | { ok: false; error: string; details?: { sourceRow?: number; unknownValue?: string } };

// ─── Zod schemas for AI output ───────────────────────────────────────────────

const ClaudePostSchema = z.object({
  source_row: z.number().int(),
  post_text: z.string().min(1),
  style_id: z.enum(STYLE_HINT_VALUES),
  composition_type: z.enum(COMPOSITION_HINT_VALUES),
  primary_colour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, { message: "primary_colour must be #RRGGBB hex" }),
  headline_text: z.string().min(1),
});

const ClaudeResponseSchema = z.object({
  posts: z.array(ClaudePostSchema).min(1),
});

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function interpretPosts(input: InterpretInput): Promise<InterpretResult> {
  if (input.posts.length === 0) {
    return { ok: false, error: "No posts to interpret." };
  }

  // Brand profile is best-effort: companies without one get a permissive
  // default (any approved style allowed; primary_colour falls back to #1A56DB
  // — the Opollo brand blue from migration 0074).
  const brand = await getActiveBrandProfile(input.companyId);
  const approvedStyles =
    brand?.approved_style_ids?.length ? brand.approved_style_ids : [...STYLE_HINT_VALUES];
  const validApprovedStyles = approvedStyles.filter((s): s is StyleId =>
    (STYLE_HINT_VALUES as readonly string[]).includes(s),
  );
  if (validApprovedStyles.length === 0) {
    return {
      ok: false,
      error: `Brand profile lists no approved styles within the canonical enum. Add at least one of: ${STYLE_HINT_VALUES.join(", ")}`,
    };
  }
  const brandPrimaryColour = brand?.primary_colour ?? "#1A56DB";
  const safeMode = brand?.safe_mode ?? false;

  // ─── Build the Anthropic prompt ──────────────────────────────────────────
  const system = buildSystemPrompt({
    approvedStyles: validApprovedStyles,
    compositionTypes: [...COMPOSITION_HINT_VALUES],
    brandPrimaryColour,
    safeMode,
  });
  const user = buildUserPrompt(input.posts);

  const call = input.anthropicCall ?? defaultAnthropicCall;
  let raw: string;
  try {
    const response = await call({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      idempotency_key: `interpret-${input.companyId}-${randomUUID()}`,
    });
    raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("interpret.anthropic_call_failed", { companyId: input.companyId, err: msg });
    return { ok: false, error: `Anthropic call failed: ${msg}` };
  }

  // ─── Parse + validate the response ───────────────────────────────────────
  const parsed = parseClaudeJson(raw);
  if (!parsed) {
    return {
      ok: false,
      error: "Anthropic response was not valid JSON matching the expected schema.",
    };
  }

  const validated = ClaudeResponseSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Anthropic response failed schema validation: ${validated.error.message}`,
    };
  }

  // ─── Cross-check against brand profile + row data ────────────────────────
  const posts: InterpretedPost[] = [];
  for (const aiPost of validated.data.posts) {
    const row = input.posts.find((p) => p.sourceRow === aiPost.source_row);
    if (!row) {
      return {
        ok: false,
        error: `Anthropic returned a post for source_row=${aiPost.source_row} that wasn't in the input.`,
        details: { sourceRow: aiPost.source_row },
      };
    }

    // Hard constraint: chosen style_id MUST be in approved_style_ids.
    if (!validApprovedStyles.includes(aiPost.style_id)) {
      return {
        ok: false,
        error: `Source row ${row.sourceRow}: AI chose style "${aiPost.style_id}" but brand approved set is [${validApprovedStyles.join(", ")}].`,
        details: { sourceRow: row.sourceRow, unknownValue: aiPost.style_id },
      };
    }

    // Honour row.style_hint verbatim (override AI if mismatched).
    const styleId: StyleId = row.style_hint ?? aiPost.style_id;
    const compositionType: CompositionType = row.composition_hint ?? aiPost.composition_type;

    // Use row.headline_text verbatim (parser already validated it).
    const headlineText = truncateHeadline(row.headline_text);

    // Derive aspect ratios deterministically.
    const aspectRatios = derivAspectRatios(row.target_platforms);

    posts.push({
      sourceRow: row.sourceRow,
      post_text: aiPost.post_text,
      image_brief: {
        style_id: styleId,
        composition_type: compositionType,
        primary_colour: aiPost.primary_colour,
        headline_text: headlineText,
        aspect_ratios: aspectRatios,
        target_platforms: row.target_platforms,
      },
    });
  }

  if (posts.length !== input.posts.length) {
    return {
      ok: false,
      error: `Anthropic returned ${posts.length} posts; expected ${input.posts.length}.`,
    };
  }

  return { ok: true, posts };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

interface SystemPromptParams {
  approvedStyles: StyleId[];
  compositionTypes: string[];
  brandPrimaryColour: string;
  safeMode: boolean;
}

function buildSystemPrompt(p: SystemPromptParams): string {
  return [
    "You are an image-brief interpreter for the Opollo social-media generator.",
    "For each input post, produce a JSON object describing both the social post copy and the image brief.",
    "",
    "Required output shape (exact JSON, no markdown fences):",
    '{ "posts": [ { "source_row": int, "post_text": string, "style_id": enum, "composition_type": enum, "primary_colour": "#RRGGBB", "headline_text": string } ] }',
    "",
    `Allowed style_id values: ${p.approvedStyles.join(", ")}`,
    `Allowed composition_type values: ${p.compositionTypes.join(", ")}`,
    `Brand primary colour (use unless content explicitly suggests otherwise): ${p.brandPrimaryColour}`,
    p.safeMode
      ? "Brand is in SAFE MODE. Pick photographic / stock-photography styles. Avoid editorial flourishes."
      : "",
    "",
    "Rules:",
    "- source_row MUST match the source_row from the input verbatim.",
    "- post_text is the actual social copy that the operator will publish (one paragraph, no hashtags unless the body explicitly suggests them).",
    "- headline_text is the text that will be RENDERED ON THE IMAGE. Keep it under 100 characters. If the input row's headline_text is set, you MUST use it verbatim; otherwise generate one from the body.",
    "- If the input row provides a style_hint or composition_hint, treat it as a strong constraint — only override if it would violate the brand's approved set.",
    "- primary_colour: prefer the brand primary colour. Override only if the post topic explicitly references a different colour (e.g. 'red sale banner').",
    "",
    "Output ONLY the JSON object. No prose, no markdown.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildUserPrompt(posts: PostRow[]): string {
  const lines: string[] = [
    `Interpret the following ${posts.length} post(s). Return one JSON object per source_row in the same order.`,
    "",
  ];
  for (const p of posts) {
    lines.push(`--- source_row=${p.sourceRow} ---`);
    lines.push(`post_topic: ${p.post_topic}`);
    lines.push(`headline_text: ${p.headline_text}`);
    lines.push(`body_text: ${p.body_text}`);
    lines.push(`target_platforms: ${p.target_platforms.join(", ")}`);
    if (p.style_hint) lines.push(`style_hint: ${p.style_hint}`);
    if (p.composition_hint) lines.push(`composition_hint: ${p.composition_hint}`);
    if (p.publish_date) lines.push(`publish_date: ${p.publish_date}`);
    if (p.notes) lines.push(`notes: ${p.notes}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseClaudeJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const unwrapped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(unwrapped);
  } catch {
    return null;
  }
}

function derivAspectRatios(platforms: string[]): AspectRatio[] {
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const code of platforms) {
    const ratio = MASS_GEN_PLATFORM_MAP[code];
    if (!ratio || seen.has(ratio)) continue;
    seen.add(ratio);
    out.push(ratio);
  }
  return out;
}

function truncateHeadline(s: string): string {
  if (s.length <= HEADLINE_CHAR_LIMIT_PER_PLATFORM) return s;
  return s.slice(0, HEADLINE_CHAR_LIMIT_PER_PLATFORM - 1) + "…";
}
