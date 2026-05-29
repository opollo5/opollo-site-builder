import "server-only";

import { MASS_GEN_PLATFORM_MAP } from "@/lib/image/types";
import { logger } from "@/lib/logger";
import {
  STYLE_HINT_VALUES,
  COMPOSITION_HINT_VALUES,
  type PostRow,
  type StyleHint,
  type CompositionHint,
} from "./xlsx-parse";

// ---------------------------------------------------------------------------
// C2 — DOCX parser for the mass-image-gen ingestion pipeline.
//
// §1.4 of MASS_IMAGE_GEN_BUILD_BRIEF. Label-based: one H1 = one post.
// Within each H1 section, the parser looks for H2 headings matching the
// allowlist (case-insensitive, whitespace-trimmed) and takes the next
// paragraphs (up to the next H2 or H1) as the value.
//
// Strategy: use mammoth.convertToHtml to render the document to a simple
// HTML string with <h1>/<h2>/<p> elements, then walk the resulting HTML
// with a minimal tag-aware tokenizer. We deliberately do not pull in a
// general HTML parser; mammoth's output is structured and bounded.
//
// Hint/placeholder filtering (per §C2):
//   - Strip any paragraph that starts with '[' and ends with ']' with no
//     other content (whitespace tolerant).
//   - Strip any paragraph whose exact-trimmed text appears in the
//     KNOWN_HINT_ALLOWLIST. The italic-formatting heuristic from v2 is
//     not used — too brittle across editors.
// ---------------------------------------------------------------------------

const H2_LABEL_TO_FIELD: Record<string, keyof PostRow | "style_hint" | "composition_hint"> = {
  headline: "headline_text",
  body: "body_text",
  platforms: "target_platforms",
  "style hint": "style_hint",
  style: "style_hint",
  "composition hint": "composition_hint",
  composition: "composition_hint",
  "publish date": "publish_date",
  date: "publish_date",
  notes: "notes",
};

/**
 * Hint paragraphs that appear in the official template, exact-trimmed.
 * The brief calls these out as "Text that appears on the image. Under 80
 * chars for square, 120 for landscape." etc. — added here as new ones land.
 *
 * Empty for v1: the official template is not yet committed to the repo.
 * When `docs/templates/mass-image-gen-template.docx` lands, regenerate
 * this list and add the corresponding allowlist regeneration test (per
 * §C2). The placeholder `[bracketed]` filter handles the common case
 * regardless.
 */
export const KNOWN_HINT_ALLOWLIST = new Set<string>([
  // Examples mentioned in the brief (kept as guidance for when the
  // template lands):
  // "Text that appears on the image. Under 80 chars for square, 120 for landscape.",
  // "Comma-separated platforms from the supported set.",
  // "YYYY-MM-DD, or leave blank.",
]);

const REQUIRED_FIELDS = ["headline_text", "body_text", "target_platforms"] as const;
const KNOWN_PLATFORMS = new Set(Object.keys(MASS_GEN_PLATFORM_MAP));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BRACKET_PLACEHOLDER_RE = /^\s*\[[^\]]*\]\s*$/;

export type DocxParseResult =
  | { ok: true; posts: PostRow[]; warnings: string[] }
  | {
      ok: false;
      error: string;
      details?: {
        postIndex?: number;
        postTopic?: string;
        unknownValue?: string;
        missingField?: string;
      };
    };

/**
 * Parse a .docx file buffer into canonical PostRow objects.
 */
export async function parseDocxBuffer(buffer: Buffer | ArrayBuffer): Promise<DocxParseResult> {
  let html: string;
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(buffer as ArrayBuffer) });
    html = result.value ?? "";
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse DOCX file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return parseDocxHtml(html);
}

/**
 * Internal — exposed for testing so we can drive the parser with hand-
 * crafted HTML without round-tripping through a real .docx binary.
 */
export function parseDocxHtml(html: string): DocxParseResult {
  const elements = tokenize(html);
  return parseElements(elements);
}

// ---------------------------------------------------------------------------
// Tokenizer — extract a flat list of {tag, text} elements from mammoth HTML
// ---------------------------------------------------------------------------

interface DocElement {
  tag: "h1" | "h2" | "p";
  text: string;
}

function tokenize(html: string): DocElement[] {
  const out: DocElement[] = [];
  // Mammoth emits well-formed HTML. Match block-level open/close pairs.
  const re = /<(h1|h2|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase() as "h1" | "h2" | "p";
    const text = stripInlineTags(m[2]).trim();
    if (text.length === 0) continue;
    out.push({ tag, text });
  }
  return out;
}

function stripInlineTags(s: string): string {
  // Mammoth uses <strong>, <em>, <a>, <br/>, <sup>, etc. Drop tags, keep text.
  return decodeEntities(s.replace(/<[^>]+>/g, ""));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Walker — collapse the flat list into one PostRow per H1 section
// ---------------------------------------------------------------------------

interface PartialPost {
  sourceIndex: number; // 1-indexed H1 ordinal
  post_topic: string;
  values: Map<string, string[]>; // field → paragraph strings (concatenated later)
}

function parseElements(elements: DocElement[]): DocxParseResult {
  const warnings: string[] = [];
  const posts: PartialPost[] = [];
  let current: PartialPost | null = null;
  let currentField: string | null = null;

  for (const el of elements) {
    if (el.tag === "h1") {
      if (current) posts.push(current);
      current = {
        sourceIndex: posts.length + 1,
        post_topic: el.text,
        values: new Map(),
      };
      currentField = null;
      continue;
    }

    if (!current) {
      // Stray content before the first H1 — informational only.
      continue;
    }

    if (el.tag === "h2") {
      const label = el.text.trim().toLowerCase();
      const field = H2_LABEL_TO_FIELD[label];
      if (!field) {
        warnings.push(`Post ${current.sourceIndex} ("${current.post_topic}"): unknown H2 "${el.text}" ignored.`);
        currentField = null;
        continue;
      }
      currentField = field;
      if (!current.values.has(field)) current.values.set(field, []);
      continue;
    }

    // p — content for the current field
    if (currentField == null) continue;
    if (isFiltered(el.text)) continue;
    const bucket = current.values.get(currentField);
    if (bucket) bucket.push(el.text);
  }
  if (current) posts.push(current);

  if (posts.length === 0) {
    return { ok: false, error: "DOCX contains no H1 sections (no posts found)." };
  }

  // ─── Materialise PartialPost → PostRow ──────────────────────────────────
  const result: PostRow[] = [];

  for (const post of posts) {
    if (!post.post_topic) {
      return {
        ok: false,
        error: `Post ${post.sourceIndex}: post_topic (the H1 heading) is empty.`,
        details: { postIndex: post.sourceIndex },
      };
    }

    // Required fields
    for (const field of REQUIRED_FIELDS) {
      const bucket = post.values.get(field);
      const value = bucket && bucket.length > 0 ? bucket.join("\n").trim() : "";
      if (!value) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): required H2 "${labelFor(field)}" is missing or empty.`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, missingField: field },
        };
      }
    }

    // Build the row.
    const headline = post.values.get("headline_text")!.join("\n").trim();
    const body = post.values.get("body_text")!.join("\n").trim();
    const platformsRaw = post.values.get("target_platforms")!.join(",").trim();

    const platforms: string[] = [];
    for (const piece of platformsRaw.split(",")) {
      const code = piece.trim().toLowerCase();
      if (!code) continue;
      if (!KNOWN_PLATFORMS.has(code)) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): unknown platform code "${code}". Known: ${[...KNOWN_PLATFORMS].join(", ")}`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, unknownValue: code },
        };
      }
      if (!platforms.includes(code)) platforms.push(code);
    }
    if (platforms.length === 0) {
      return {
        ok: false,
        error: `Post ${post.sourceIndex} ("${post.post_topic}"): target_platforms is empty after parsing.`,
        details: { postIndex: post.sourceIndex },
      };
    }

    // Optional: style_hint
    let styleHint: StyleHint | undefined;
    const styleRaw = (post.values.get("style_hint") ?? []).join("\n").trim();
    if (styleRaw) {
      const v = styleRaw.toLowerCase();
      if (!STYLE_HINT_VALUES.includes(v as StyleHint)) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): unknown style hint "${styleRaw}". Known: ${STYLE_HINT_VALUES.join(", ")}`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, unknownValue: styleRaw },
        };
      }
      styleHint = v as StyleHint;
    }

    // Optional: composition_hint
    let compositionHint: CompositionHint | undefined;
    const compRaw = (post.values.get("composition_hint") ?? []).join("\n").trim();
    if (compRaw) {
      const v = compRaw.toLowerCase();
      if (!COMPOSITION_HINT_VALUES.includes(v as CompositionHint)) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): unknown composition hint "${compRaw}". Known: ${COMPOSITION_HINT_VALUES.join(", ")}`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, unknownValue: compRaw },
        };
      }
      compositionHint = v as CompositionHint;
    }

    // Optional: publish_date
    let publishDate: string | undefined;
    const dateRaw = (post.values.get("publish_date") ?? []).join("\n").trim();
    if (dateRaw) {
      if (!DATE_RE.test(dateRaw)) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): publish date "${dateRaw}" is not YYYY-MM-DD.`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, unknownValue: dateRaw },
        };
      }
      const [, mm, dd] = dateRaw.split("-").map((n) => parseInt(n, 10));
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
        return {
          ok: false,
          error: `Post ${post.sourceIndex} ("${post.post_topic}"): publish date "${dateRaw}" is not a real calendar date.`,
          details: { postIndex: post.sourceIndex, postTopic: post.post_topic, unknownValue: dateRaw },
        };
      }
      publishDate = dateRaw;
    }

    // Optional: notes
    let notes: string | undefined;
    const notesRaw = (post.values.get("notes") ?? []).join("\n").trim();
    if (notesRaw) notes = notesRaw;

    result.push({
      sourceRow: post.sourceIndex, // H1 ordinal; same semantic as XLSX rowNumber
      post_topic: post.post_topic,
      headline_text: headline,
      body_text: body,
      target_platforms: platforms,
      ...(styleHint && { style_hint: styleHint }),
      ...(compositionHint && { composition_hint: compositionHint }),
      ...(publishDate && { publish_date: publishDate }),
      ...(notes && { notes }),
    });
  }

  return { ok: true, posts: result, warnings };
}

function isFiltered(text: string): boolean {
  // [bracketed placeholder] with nothing else
  if (BRACKET_PLACEHOLDER_RE.test(text)) {
    logger.debug?.("docx_parse.placeholder_stripped", { text });
    return true;
  }
  // Known-hint allowlist (exact trimmed match)
  if (KNOWN_HINT_ALLOWLIST.has(text.trim())) {
    logger.debug?.("docx_parse.hint_stripped", { text });
    return true;
  }
  return false;
}

function labelFor(field: string): string {
  switch (field) {
    case "headline_text":
      return "Headline";
    case "body_text":
      return "Body";
    case "target_platforms":
      return "Platforms";
    case "style_hint":
      return "Style hint";
    case "composition_hint":
      return "Composition hint";
    case "publish_date":
      return "Publish date";
    case "notes":
      return "Notes";
    default:
      return field;
  }
}
