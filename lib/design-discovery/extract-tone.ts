import "server-only";

import { z } from "zod";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { extractCssFromUrl } from "@/lib/design-discovery/extract-css";
import { extractJsonFromOutputTags } from "@/lib/design-discovery/generate-concepts";
import {
  buildStyleGuide,
  type AvoidOption,
  type PersonalityOption,
} from "@/lib/design-discovery/tone-mapping";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — tone-of-voice extraction (PR 8).
//
// Single Claude call that takes the operator's inputs (existing
// content URL, sample copy, personality / avoid markers, target
// audience, admired brand) and returns:
//   - The structured tone_of_voice JSON the spec mandates
//   - Three sample text blocks (hero, service description, blog
//     opening paragraph) the operator can edit before approving
//
// Fetching the existing content URL happens server-side via the
// existing extractCssFromUrl helper which we re-use for raw HTML.
// We strip HTML tags into plain prose and feed the first ~6000
// characters to the model.
// ---------------------------------------------------------------------------

const TONE_MODEL = "claude-sonnet-4-6";
const TONE_MAX_TOKENS = 4096;

const ToneOfVoiceSchema = z.object({
  formality_level: z.number().min(1).max(5),
  sentence_length: z.union([
    z.literal("short"),
    z.literal("medium"),
    z.literal("long"),
  ]),
  jargon_usage: z.union([
    z.literal("embraced"),
    z.literal("neutral"),
    z.literal("avoided"),
  ]),
  personality_markers: z.array(z.string()).max(20),
  avoid_markers: z.array(z.string()).max(20),
  target_audience: z.string().max(500),
  style_guide: z.string().min(1).max(4000),
});

const SampleSchema = z.object({
  kind: z.union([
    z.literal("hero"),
    z.literal("service"),
    z.literal("blog"),
  ]),
  text: z.string().min(1).max(800),
});

const ExtractionResponseSchema = z.object({
  tone_of_voice: ToneOfVoiceSchema,
  samples: z.array(SampleSchema).length(3),
});

export type ToneOfVoice = z.infer<typeof ToneOfVoiceSchema>;
export type ToneSample = z.infer<typeof SampleSchema>;

export interface ToneInputs {
  industry: string;
  existing_content_url: string | null;
  sample_copy: string | null;
  target_audience: string | null;
  personality: PersonalityOption[];
  avoid: AvoidOption[];
  admired_brand: string | null;
}

export interface ToneExtractionResult {
  tone_of_voice: ToneOfVoice;
  samples: ToneSample[];
  source: { fetched_url: string; bytes: number } | null;
}

const TONE_SYSTEM_PROMPT = `You are a senior brand strategist at a top agency. The operator captured inputs about how an MSP/IT-services site should sound; your job is to produce the structured tone-of-voice JSON the downstream generation pipeline reads, plus three sample text blocks the operator reviews and edits before approving.

Output strictly the JSON below, wrapped in <output>...</output>. No prose outside the tags.

{
  "tone_of_voice": {
    "formality_level": 3,                       // 1 (very casual) – 5 (very formal)
    "sentence_length": "short" | "medium" | "long",
    "jargon_usage": "embraced" | "neutral" | "avoided",
    "personality_markers": ["professional", "friendly", ...],
    "avoid_markers": ["salesy", "jargon-heavy", ...],
    "target_audience": "Short description of who the site speaks to.",
    "style_guide": "Multi-paragraph prose writing instructions. Concrete dos and don'ts. Includes the operator-supplied multi-select rules verbatim. Used as system context in every downstream generation."
  },
  "samples": [
    { "kind": "hero", "text": "Headline + subheadline (max 2 sentences)." },
    { "kind": "service", "text": "Service description paragraph (max 100 words)." },
    { "kind": "blog", "text": "Blog opening paragraph (max 100 words)." }
  ]
}

Style_guide rules:
- Always include the operator's multi-select prose rules verbatim — never drop them.
- Add 2–4 additional rules grounded in any pasted sample copy or fetched content.
- Concrete: prefer "Sentences under 20 words." over "be concise".
- Lead with what to do; finish with what to avoid.
- 4–10 sentences total.`;

function htmlToPlainText(html: string): string {
  // Cheap HTML → text. Skip script/style content; collapse whitespace.
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text.replace(/\s+/g, " ").trim();
}

async function fetchSiteProse(url: string): Promise<string | null> {
  const css = await extractCssFromUrl(url);
  if (!css.fetch_ok) return null;
  // We want the raw HTML to strip prose. extractCssFromUrl doesn't
  // expose it; fetch once more (cached at the host's cache layer).
  // Cheap: one extra request, both go through the same fetch wrapper.
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Opollo-Site-Builder/1.0 (+https://opollo.com) Tone-Extraction",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const prose = htmlToPlainText(html);
    return prose.slice(0, 6000);
  } catch {
    return null;
  }
}

function buildUserMessage(
  inputs: ToneInputs,
  fetchedProse: string | null,
): string {
  const styleSeed = buildStyleGuide(
    inputs.personality,
    inputs.avoid,
    inputs.target_audience,
    inputs.admired_brand,
  );
  const lines: string[] = [];
  lines.push(`Industry: ${inputs.industry}`);
  if (inputs.target_audience) {
    lines.push(`Target audience (operator-supplied): ${inputs.target_audience}`);
  }
  if (inputs.admired_brand) {
    lines.push(`Admired brand (style reference): ${inputs.admired_brand}`);
  }
  if (inputs.personality.length > 0) {
    lines.push(`Personality multi-select: ${inputs.personality.join(", ")}`);
  }
  if (inputs.avoid.length > 0) {
    lines.push(`Never-sound-like multi-select: ${inputs.avoid.join(", ")}`);
  }
  if (styleSeed) {
    lines.push("");
    lines.push("Multi-select prose seed (include verbatim in style_guide):");
    lines.push(styleSeed);
  }
  if (inputs.sample_copy) {
    lines.push("");
    lines.push("Pasted sample copy:");
    lines.push(inputs.sample_copy.slice(0, 4000));
  }
  if (fetchedProse) {
    lines.push("");
    lines.push("Fetched existing content (truncated):");
    lines.push(fetchedProse);
  }
  lines.push("");
  lines.push(
    "Produce the JSON now. The samples MUST follow the resulting tone_of_voice consistently.",
  );
  return lines.join("\n");
}

function idempotencyKey(siteId: string, inputs: ToneInputs, attempt: number): string {
  const json = JSON.stringify({
    industry: inputs.industry,
    url: inputs.existing_content_url ?? "",
    sample: (inputs.sample_copy ?? "").slice(0, 200),
    audience: inputs.target_audience ?? "",
    p: inputs.personality,
    a: inputs.avoid,
    brand: inputs.admired_brand ?? "",
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) h = (h * 31 + json.charCodeAt(i)) | 0;
  return `tone:${siteId}:${Math.abs(h).toString(36)}:${attempt}`;
}

export async function extractTone(
  inputs: ToneInputs,
  ctx: { siteId: string },
  callOverride?: AnthropicCallFn,
): Promise<
  | { ok: true; data: ToneExtractionResult }
  | { ok: false; error: { code: "GENERATION_FAILED" | "NO_INPUT"; message: string } }
> {
  const hasInputs =
    Boolean(inputs.existing_content_url?.trim()) ||
    Boolean(inputs.sample_copy?.trim()) ||
    inputs.personality.length > 0 ||
    inputs.avoid.length > 0 ||
    Boolean(inputs.target_audience?.trim()) ||
    Boolean(inputs.admired_brand?.trim());
  if (!hasInputs) {
    return {
      ok: false,
      error: {
        code: "NO_INPUT",
        message: "Add at least one input (URL, sample copy, or guided answers).",
      },
    };
  }

  let fetchedProse: string | null = null;
  let source: ToneExtractionResult["source"] = null;
  if (inputs.existing_content_url?.trim()) {
    const url = inputs.existing_content_url.trim();
    fetchedProse = await fetchSiteProse(url);
    if (fetchedProse) {
      source = { fetched_url: url, bytes: fetchedProse.length };
    }
  }

  const call = callOverride ?? defaultAnthropicCall;
  const system = TONE_SYSTEM_PROMPT;
  const user = buildUserMessage(inputs, fetchedProse);

  const tryOnce = async (attempt: number): Promise<ToneExtractionResult | string> => {
    try {
      const res = await call({
        model: TONE_MODEL,
        max_tokens: TONE_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        idempotency_key: idempotencyKey(ctx.siteId, inputs, attempt),
      });
      const text = res.content.map((b) => b.text).join("");
      const json = extractJsonFromOutputTags(text);
      const parsed = ExtractionResponseSchema.safeParse(json);
      if (!parsed.success) {
        return `parse failed: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`;
      }
      return {
        tone_of_voice: parsed.data.tone_of_voice,
        samples: parsed.data.samples,
        source,
      };
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const first = await tryOnce(1);
  if (typeof first !== "string") return { ok: true, data: first };

  logger.warn("design-discovery.tone.attempt-1-failed", {
    site_id: ctx.siteId,
    error: first,
  });
  const second = await tryOnce(2);
  if (typeof second !== "string") return { ok: true, data: second };

  logger.error("design-discovery.tone.attempt-2-failed", {
    site_id: ctx.siteId,
    error: second,
  });
  return {
    ok: false,
    error: { code: "GENERATION_FAILED", message: second },
  };
}

// Sample-only regeneration after tone is already extracted. Used by
// the "Regenerate samples" button. Cheaper call (max_tokens 1024).
const SAMPLE_SYSTEM_PROMPT = `You are a senior copywriter. Given a tone_of_voice JSON profile and an optional regeneration note, produce three fresh sample text blocks (hero, service, blog) consistent with the tone. Output strictly:

<output>
{
  "samples": [
    { "kind": "hero", "text": "..." },
    { "kind": "service", "text": "..." },
    { "kind": "blog", "text": "..." }
  ]
}
</output>`;

const SamplesOnlySchema = z.object({
  samples: z.array(SampleSchema).length(3),
});

export async function regenerateSamples(
  tone: ToneOfVoice,
  feedback: string | null,
  ctx: { siteId: string; attempt: number },
  callOverride?: AnthropicCallFn,
): Promise<
  | { ok: true; samples: ToneSample[] }
  | { ok: false; error: { code: "GENERATION_FAILED"; message: string } }
> {
  const call = callOverride ?? defaultAnthropicCall;
  const lines = [
    "tone_of_voice:",
    JSON.stringify(tone, null, 2),
    "",
    feedback?.trim()
      ? `Regeneration note (apply): ${feedback.trim()}`
      : "Regenerate fresh samples; vary specifics from prior outputs.",
  ];
  try {
    const res = await call({
      model: TONE_MODEL,
      max_tokens: 1024,
      system: SAMPLE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: lines.join("\n") }],
      idempotency_key: `tone-samples:${ctx.siteId}:${ctx.attempt}:${Date.now()}`,
    });
    const text = res.content.map((b) => b.text).join("");
    const json = extractJsonFromOutputTags(text);
    const parsed = SamplesOnlySchema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "GENERATION_FAILED",
          message: "Parse failed.",
        },
      };
    }
    return { ok: true, samples: parsed.data.samples };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "GENERATION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
