import "server-only";

import { z } from "zod";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
  type AnthropicContentBlock,
} from "@/lib/anthropic-call";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY-FOLLOWUP — screenshot vision extraction.
//
// The setup wizard's Step-1 input surface accepts up to 5 image
// uploads (see design-brief.ts: screenshots reserved). Operator
// uploads → client posts base64 PNGs/JPEGs/WebPs/GIFs to this lib's
// API route → we ask Claude to extract design patterns the operator
// wants reflected in the generated concepts.
//
// Output: same shape as the URL-extraction snapshot (swatches /
// fonts / layout_tags / visual_tone_tags) so the mood-board strip
// can merge URL-extraction signals with vision-extraction signals
// without two code paths.
//
// Model: project's current Sonnet (claude-sonnet-4-6). The brief's
// reference to claude-sonnet-4-20250514 is a 2024 vintage that's not
// in lib/anthropic-pricing.ts:PRICING_TABLE; using the allow-listed
// equivalent keeps the wrapper's idempotency + cost-tracking
// invariants intact.
// ---------------------------------------------------------------------------

const VISION_MODEL = "claude-sonnet-4-6";
const VISION_MAX_TOKENS = 1024;

export type ScreenshotMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export interface ScreenshotInput {
  data: string; // base64 (no data: prefix)
  media_type: ScreenshotMediaType;
}

// Same shape as ExtractedSnapshot, minus screenshot_url / source_url
// (those are URL-extraction concepts).
export interface ScreenshotExtractionResult {
  swatches: string[];
  fonts: string[];
  layout_tags: string[];
  visual_tone_tags: string[];
}

const ExtractedJsonSchema = z.object({
  swatches: z.array(z.string()).max(8).default([]),
  fonts: z.array(z.string()).max(6).default([]),
  layout_tags: z.array(z.string()).max(8).default([]),
  visual_tone_tags: z.array(z.string()).max(8).default([]),
});

const SYSTEM_PROMPT = `You are a senior visual designer doing a fast pattern read on inspiration screenshots a client just uploaded. Look at every image and return ONE consolidated set of design signals — colours, type feel, layout patterns, visual tone — that capture what the client is gravitating towards.

Respond ONLY with a JSON object inside <output></output> tags, with this exact shape:

{
  "swatches": ["#rrggbb", ...],         // up to 8 hex colours, ordered by visual prominence
  "fonts": ["Inter", "Source Serif", ...], // up to 6 font-family names; if you can't read a name, describe ("geometric sans", "humanist serif")
  "layout_tags": ["centred-hero", "card-grid", "two-column", ...], // up to 8 short layout descriptors
  "visual_tone_tags": ["minimal", "warm", "high-contrast", ...]   // up to 8 short tone descriptors
}

Do NOT include any other commentary. Do NOT include rationale. Do NOT include image-specific notes — collapse signals across all images into one consolidated set.`;

const OUTPUT_RE = /<output>\s*([\s\S]+?)\s*<\/output>/i;

export function parseVisionOutput(
  text: string,
): ScreenshotExtractionResult | null {
  const m = OUTPUT_RE.exec(text);
  const blob = m ? m[1] : text;
  if (!blob) return null;
  let json: unknown;
  try {
    json = JSON.parse(blob);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(blob);
    if (!fenced || !fenced[1]) return null;
    try {
      json = JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
  const parsed = ExtractedJsonSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data;
}

function idempotencyKey(
  siteId: string,
  digest: string,
  attempt: number,
): string {
  return `screenshots:${siteId}:${digest}:${attempt}`;
}

// Stable digest of the screenshots payload — base64 length + first /
// last 16 chars of each image. Cheap, collision-resistant enough for
// idempotency-key scope (Anthropic's 24h window dedups same-key calls).
function digestScreenshots(images: ScreenshotInput[]): string {
  const parts = images.map((img) => {
    const head = img.data.slice(0, 16);
    const tail = img.data.slice(-16);
    return `${img.media_type}:${img.data.length}:${head}:${tail}`;
  });
  let h = 0;
  const joined = parts.join("|");
  for (let i = 0; i < joined.length; i++) {
    h = (h * 31 + joined.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export async function extractFromScreenshots(
  images: ScreenshotInput[],
  ctx: { siteId: string },
  callOverride?: AnthropicCallFn,
): Promise<
  | { ok: true; data: ScreenshotExtractionResult }
  | { ok: false; error: { code: string; message: string } }
> {
  if (images.length === 0) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "At least one screenshot is required.",
      },
    };
  }
  const call = callOverride ?? defaultAnthropicCall;
  const digest = digestScreenshots(images);

  const content: AnthropicContentBlock[] = [
    ...images.map(
      (img): AnthropicContentBlock => ({
        type: "image",
        source: {
          type: "base64",
          media_type: img.media_type,
          data: img.data,
        },
      }),
    ),
    {
      type: "text",
      text: "Read the visual signals across these screenshots and return the consolidated JSON described in the system prompt.",
    },
  ];

  const tryOnce = async (
    attempt: number,
  ): Promise<ScreenshotExtractionResult | string> => {
    try {
      const res = await call({
        model: VISION_MODEL,
        max_tokens: VISION_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        idempotency_key: idempotencyKey(ctx.siteId, digest, attempt),
      });
      const text = res.content.map((b) => b.text).join("");
      const parsed = parseVisionOutput(text);
      if (!parsed) return "parse failed";
      return parsed;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const first = await tryOnce(1);
  if (typeof first !== "string") return { ok: true, data: first };
  logger.warn("design-discovery.screenshots.attempt-1-failed", {
    site_id: ctx.siteId,
    error: first,
  });
  const second = await tryOnce(2);
  if (typeof second !== "string") return { ok: true, data: second };
  logger.error("design-discovery.screenshots.attempt-2-failed", {
    site_id: ctx.siteId,
    error: second,
  });
  return {
    ok: false,
    error: { code: "VISION_FAILED", message: second },
  };
}
