import "server-only";

import { z } from "zod";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import {
  ALL_DIRECTIONS,
  buildConceptUserMessage,
  directionLabel,
  getConceptSystemPrompt,
  type ConceptDirection,
} from "@/lib/design-discovery/concept-prompt";
import type { DesignBrief } from "@/lib/design-discovery/design-brief";
import { normalizeConceptHtml } from "@/lib/design-discovery/normalize-html";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — concept generation orchestrator.
//
// Fires THREE parallel Anthropic calls (one per direction) with
// per-call retries (1 retry on parse-fail or transport error). Each
// successful response is JSON-parsed, validated against a Zod
// schema, and run through the HTML normalization pass. Returns the
// 3-tuple of results — a partial result is fine; the caller renders
// 2 cards while a 3rd retries.
//
// Idempotency: each call's idempotency-key is deterministic on
// (siteId, direction, brief-hash). A retry replays the same key so
// Anthropic's 24-hour idempotency cache doesn't double-bill.
// ---------------------------------------------------------------------------

// Use the project's current Sonnet model — claude-sonnet-4-20250514
// from the workstream brief is a 2024 vintage that's not in the
// allowlist. claude-sonnet-4-6 is the project's current Sonnet
// (lib/anthropic-models.ts) and matches the spec's intent.
const CONCEPT_MODEL = "claude-sonnet-4-6";
const CONCEPT_MAX_TOKENS = 4096;

const DesignTokensSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  background: z.string(),
  text: z.string(),
  font_heading: z.string(),
  font_body: z.string(),
  border_radius: z.string(),
  spacing_unit: z.string(),
});

const ConceptOutputSchema = z.object({
  rationale: z.string().min(1).max(600),
  design_tokens: DesignTokensSchema,
  homepage_html: z.string().min(50),
  inner_page_html: z.string().min(50),
  micro_ui: z.object({
    button: z.string().min(1),
    card: z.string().min(1),
    input: z.string().min(1),
  }),
});

export type ConceptResult = {
  direction: ConceptDirection;
  label: string;
  rationale: string;
  design_tokens: z.infer<typeof DesignTokensSchema>;
  homepage_html: string;
  inner_page_html: string;
  micro_ui: { button: string; card: string; input: string };
  normalization_warnings: string[];
};

export type ConceptError = {
  direction: ConceptDirection;
  label: string;
  message: string;
};

export interface GenerateConceptsResult {
  concepts: ConceptResult[];
  errors: ConceptError[];
}

// ---- helpers ----

const OUTPUT_RE = /<output>\s*([\s\S]+?)\s*<\/output>/i;

export function extractJsonFromOutputTags(text: string): unknown | null {
  const m = OUTPUT_RE.exec(text);
  const blob = m ? m[1] : text;
  if (!blob) return null;
  try {
    return JSON.parse(blob);
  } catch {
    // Sometimes the model wraps the JSON in markdown fences.
    const fenced = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(blob);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function briefHash(brief: DesignBrief): string {
  // Cheap stable hash. Anthropic's idempotency-key requires < 64 chars.
  // We hash only the operator-supplied fields, skipping refinement_notes
  // (those need a fresh idempotency key per refinement to land a new
  // generation — refinement is a separate code path in PR 7).
  const json = JSON.stringify({
    industry: brief.industry,
    reference_url: brief.reference_url ?? "",
    existing_site_url: brief.existing_site_url ?? "",
    description: brief.description ?? "",
    edited_understanding: brief.edited_understanding ?? "",
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (h * 31 + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function idempotencyKeyFor(
  siteId: string,
  direction: ConceptDirection,
  hash: string,
  attempt: number,
): string {
  return `concept:${siteId}:${direction}:${hash}:${attempt}`;
}

async function generateOne(
  brief: DesignBrief,
  direction: ConceptDirection,
  siteId: string,
  siteName: string,
  call: AnthropicCallFn,
): Promise<ConceptResult | ConceptError> {
  const hash = briefHash(brief);
  const system = getConceptSystemPrompt();
  const user = buildConceptUserMessage(brief, direction, siteName);

  const tryOnce = async (attempt: number): Promise<ConceptResult | string> => {
    try {
      const res = await call({
        model: CONCEPT_MODEL,
        max_tokens: CONCEPT_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        idempotency_key: idempotencyKeyFor(siteId, direction, hash, attempt),
      });
      const text = res.content.map((b) => b.text).join("");
      const json = extractJsonFromOutputTags(text);
      const parsed = ConceptOutputSchema.safeParse(json);
      if (!parsed.success) {
        return `parse failed: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`;
      }
      const homepage = normalizeConceptHtml(parsed.data.homepage_html);
      const inner = normalizeConceptHtml(parsed.data.inner_page_html);
      return {
        direction,
        label: directionLabel(direction),
        rationale: parsed.data.rationale,
        design_tokens: parsed.data.design_tokens,
        homepage_html: homepage.html,
        inner_page_html: inner.html,
        micro_ui: parsed.data.micro_ui,
        normalization_warnings: [
          ...homepage.warnings,
          ...inner.warnings,
        ],
      };
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const first = await tryOnce(1);
  if (typeof first !== "string") return first;

  logger.warn("design-discovery.concept.attempt-1-failed", {
    site_id: siteId,
    direction,
    error: first,
  });
  const second = await tryOnce(2);
  if (typeof second !== "string") return second;

  logger.error("design-discovery.concept.attempt-2-failed", {
    site_id: siteId,
    direction,
    error: second,
  });
  return {
    direction,
    label: directionLabel(direction),
    message: second,
  };
}

export async function generateConcepts(
  brief: DesignBrief,
  ctx: { siteId: string; siteName: string },
  callOverride?: AnthropicCallFn,
): Promise<GenerateConceptsResult> {
  const call = callOverride ?? defaultAnthropicCall;
  const settled = await Promise.all(
    ALL_DIRECTIONS.map((d) =>
      generateOne(brief, d, ctx.siteId, ctx.siteName, call),
    ),
  );
  const concepts: ConceptResult[] = [];
  const errors: ConceptError[] = [];
  for (const r of settled) {
    if ("homepage_html" in r) concepts.push(r);
    else errors.push(r);
  }
  return { concepts, errors };
}

// Single-direction regenerate path used by the refinement loop (PR 7).
// Call site: operator selects a concept → writes feedback into
// brief.refinement_notes → posts to /setup/refine-concept which fans
// out to this function. We re-use the same prompt; the only delta is
// that refinement_notes is non-empty so the user message includes
// "Refinement notes (apply these): ..." and the model updates the
// concept accordingly.
export async function regenerateConcept(
  brief: DesignBrief,
  direction: ConceptDirection,
  ctx: { siteId: string; siteName: string },
  callOverride?: AnthropicCallFn,
): Promise<ConceptResult | ConceptError> {
  const call = callOverride ?? defaultAnthropicCall;
  return generateOne(brief, direction, ctx.siteId, ctx.siteName, call);
}
