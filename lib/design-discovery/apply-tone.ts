import "server-only";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — apply approved tone of voice to approved homepage.
//
// Runs once after tone approval (PR 9 of the workstream). Single
// Sonnet call: rewrite ONLY the text content of the hero, CTA
// section, and first service card. Preserve all HTML structure, CSS,
// class names, layout, non-text content. Store result as
// tone_applied_homepage_html. Failure is silent — caller falls
// back to the original approved homepage_concept_html per the
// spec.
// ---------------------------------------------------------------------------

const APPLY_TONE_MODEL = "claude-sonnet-4-6";
const APPLY_TONE_MAX_TOKENS = 4096;

interface ApplyToneInputs {
  homepage_html: string;
  style_guide: string;
  approved_samples: Array<{ kind: string; text: string }>;
}

const APPLY_TONE_SYSTEM_PROMPT = `You are a senior copywriter rewriting marketing site copy to match a given tone of voice. The HTML you receive is a complete homepage; you rewrite ONLY the text content of three regions, leaving everything else byte-for-byte identical:

1. Hero section (.ls-hero) — headline, subheadline, primary CTA button text
2. CTA section (.ls-cta) — heading and button text
3. The FIRST service card under .ls-services — title + description ONLY

Do NOT change:
- Any HTML structure, tags, attributes, class names, IDs, data attributes
- Any inline CSS or <style> blocks
- Any layout, spacing, colors, or non-text content
- Any other section's text (value-prop, social proof, footer)
- The 2nd / 3rd service cards
- The order or structure of sections

Output strictly the updated full HTML, wrapped in <output>...</output>. No JSON, no commentary, no markdown.`;

function buildUserMessage(inputs: ApplyToneInputs): string {
  const lines: string[] = [];
  lines.push("Style guide (apply this voice):");
  lines.push(inputs.style_guide);
  lines.push("");
  if (inputs.approved_samples.length > 0) {
    lines.push("Few-shot voice examples (these have been operator-approved as on-brand):");
    for (const s of inputs.approved_samples) {
      lines.push(`- ${s.kind}: ${s.text}`);
    }
    lines.push("");
  }
  lines.push("Original homepage HTML (rewrite ONLY hero, CTA, first service card text — leave everything else byte-for-byte identical):");
  lines.push("");
  lines.push(inputs.homepage_html);
  return lines.join("\n");
}

const OUTPUT_RE = /<output>\s*([\s\S]+?)\s*<\/output>/i;

export type ApplyToneResult =
  | { ok: true; tone_applied_html: string }
  | { ok: false; error: { code: "GENERATION_FAILED" | "NOT_FOUND" | "INTERNAL_ERROR"; message: string } };

export async function applyToneToHomepage(
  siteId: string,
  callOverride?: AnthropicCallFn,
): Promise<ApplyToneResult> {
  const supabase = getServiceRoleClient();

  // Read the approved homepage + tone JSONB. Both must be present.
  const { data, error } = await supabase
    .from("sites")
    .select(
      "homepage_concept_html, tone_of_voice, design_direction_status, tone_of_voice_status",
    )
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: `Site ${siteId} not found.` },
    };
  }
  const homepage = data.homepage_concept_html as string | null;
  const tone = data.tone_of_voice as Record<string, unknown> | null;
  if (!homepage || !tone) {
    // Nothing to apply — design + tone must both be approved first.
    // Caller should have checked; we fail soft here.
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          "Cannot apply tone: homepage_concept_html or tone_of_voice missing.",
      },
    };
  }
  const styleGuide =
    typeof tone.style_guide === "string" ? tone.style_guide : "";
  const samples = Array.isArray(tone.approved_samples)
    ? (tone.approved_samples as Array<{ kind?: unknown; text?: unknown }>)
        .filter(
          (s): s is { kind: string; text: string } =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as { kind?: unknown }).kind === "string" &&
            typeof (s as { text?: unknown }).text === "string",
        )
        .map((s) => ({ kind: s.kind, text: s.text }))
    : [];
  if (!styleGuide) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "tone_of_voice.style_guide is empty; nothing to apply.",
      },
    };
  }

  const call = callOverride ?? defaultAnthropicCall;
  let text: string;
  try {
    const res = await call({
      model: APPLY_TONE_MODEL,
      max_tokens: APPLY_TONE_MAX_TOKENS,
      system: APPLY_TONE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserMessage({
            homepage_html: homepage,
            style_guide: styleGuide,
            approved_samples: samples,
          }),
        },
      ],
      idempotency_key: `apply-tone:${siteId}:${homepage.length}:${styleGuide.length}`,
    });
    text = res.content.map((b) => b.text).join("");
  } catch (err) {
    logger.warn("design-discovery.apply-tone.call-failed", {
      site_id: siteId,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: {
        code: "GENERATION_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const m = OUTPUT_RE.exec(text);
  const html = (m ? m[1] : text).trim();
  if (!html || html.length < 100 || !/<section[^>]*class="[^"]*ls-hero/i.test(html)) {
    logger.warn("design-discovery.apply-tone.unparsable", {
      site_id: siteId,
      output_bytes: html.length,
    });
    return {
      ok: false,
      error: {
        code: "GENERATION_FAILED",
        message: "Output failed sanity check (missing ls-hero section or too short).",
      },
    };
  }

  const upd = await supabase
    .from("sites")
    .update({
      tone_applied_homepage_html: html,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (upd.error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: upd.error.message },
    };
  }
  if (!upd.data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: `Site ${siteId} not found.` },
    };
  }
  return { ok: true, tone_applied_html: html };
}
