import { createHash } from "node:crypto";

import {
  defaultAnthropicCall,
  type AnthropicCallFn,
} from "@/lib/anthropic-call";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// M12-1 — brief parser.
//
// Input: the raw bytes of an uploaded brief document (text/plain or
// text/markdown). Output: an ordered list of pages, each carrying a
// verbatim `source_text` from the input, a `word_count`, a `mode`
// (`full_text` vs `short_brief` inferred by word count), and optional
// byte-span offsets into the source.
//
// Two execution paths:
//
//   1. Structural-first (preferred, deterministic, free). Tries markdown
//      H2, H1-fallback, `---` hrule, and "Page N:" numbered headers, in
//      that order. First rule that extracts ≥ 1 page wins.
//
//   2. Claude-inference fallback. Fires only when structural-first
//      returns zero pages. One Claude call with the whole document in a
//      `<brief_document>` tag + a system prompt instructing a JSON list
//      with per-entry `source_quote`. Idempotency key `brief-parse:
//      <brief_id>:<source_sha256>` so a retry returns the cached
//      response instead of re-billing.
//
// Every returned entry carries a verbatim `source_text` slice. The
// review UI shows the quote so the operator can catch a hallucinated
// entry before commit. Inference entries whose `source_quote` is not a
// substring of the source are dropped + warned. Parent plan risk #2.
// ---------------------------------------------------------------------------

export type BriefParserMode = "structural" | "claude_inference";
export type BriefPageMode = "full_text" | "short_brief";

export type ParserWarning = {
  code:
    | "UNCLOSED_CODE_FENCE"
    | "MALFORMED_FRONTMATTER"
    | "INFERENCE_ENTRY_DROPPED"
    | "HEADING_HIERARCHY_SKIPPED"
    | "TRAILING_EMPTY_SECTION";
  detail?: string;
};

export type BriefPageDraft = {
  ordinal: number;
  title: string;
  mode: BriefPageMode;
  source_text: string;
  word_count: number;
  source_span_start: number | null;
  source_span_end: number | null;
};

export type BriefParseResult =
  | {
      ok: true;
      parser_mode: BriefParserMode;
      pages: BriefPageDraft[];
      warnings: ParserWarning[];
    }
  | {
      ok: false;
      code:
        | "EMPTY_DOCUMENT"
        | "NO_PARSABLE_STRUCTURE"
        | "INFERENCE_FALLBACK_FAILED";
      detail: string;
      warnings: ParserWarning[];
    };

// Pages of this word count or more are `full_text`; anything shorter is
// a `short_brief`. Matches the parent plan's 400-word threshold.
const FULL_TEXT_WORD_THRESHOLD = 400;

// Claude inference expects this model + token budget.
const INFERENCE_MODEL = "claude-sonnet-4-6";
const INFERENCE_MAX_TOKENS = 4096;

// `source_quote` strings shorter than this cannot be uniquely located in
// the source text — reject them early.
const MIN_INFERENCE_QUOTE_CHARS = 50;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function inferMode(wordCount: number): BriefPageMode {
  return wordCount >= FULL_TEXT_WORD_THRESHOLD ? "full_text" : "short_brief";
}

// ---------------------------------------------------------------------------
// Frontmatter handling — strip valid or malformed YAML frontmatter
// before structural parsing. Returns the body + an offset so span
// calculations land against the original byte stream.
// ---------------------------------------------------------------------------

function stripFrontmatter(source: string): {
  body: string;
  offset: number;
  warning: ParserWarning | null;
} {
  if (!source.startsWith("---")) return { body: source, offset: 0, warning: null };

  // Look for the closing --- on its own line. The opening is on line 1.
  const afterFirst = source.indexOf("\n", 3);
  if (afterFirst === -1) {
    return { body: source, offset: 0, warning: null };
  }
  const closeMatch = /\n---\s*(?:\n|$)/.exec(source.slice(afterFirst));
  if (!closeMatch) {
    // Opened but never closed — treat as malformed frontmatter; strip
    // the opening --- line only, warn the operator.
    const firstLineEnd = source.indexOf("\n");
    const offset = firstLineEnd + 1;
    return {
      body: source.slice(offset),
      offset,
      warning: {
        code: "MALFORMED_FRONTMATTER",
        detail: "Frontmatter block was opened but never closed; stripped the opening line only.",
      },
    };
  }
  const closeEnd = afterFirst + closeMatch.index + closeMatch[0].length;
  return { body: source.slice(closeEnd), offset: closeEnd, warning: null };
}

// ---------------------------------------------------------------------------
// Unclosed code fence detection — fire a warning but treat fence bodies
// as regular content for structural parsing.
// ---------------------------------------------------------------------------

function detectUnclosedFence(source: string): ParserWarning | null {
  const fenceMatches = source.match(/^```/gm);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    return {
      code: "UNCLOSED_CODE_FENCE",
      detail: "Document contains an unclosed ``` fence; treated fence body as prose.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Structural path #1 — markdown H2 delimiters (primary).
// Every `## <title>` line starts a new page.
// ---------------------------------------------------------------------------

function parseByH2(body: string, offset: number): BriefPageDraft[] {
  // UAT (2026-05-03 round-3): tolerate up to 3 spaces of leading
  // whitespace on heading lines per CommonMark §4.2 (ATX headings).
  // Operators frequently paste briefs from indented code blocks — the
  // prior `^##` anchor required column 0, which silently turned every
  // ## heading into body text and the parser dropped to single-page
  // fallback. Tabs are normalised to spaces in pre-processing already
  // so [ \t] is belt-and-suspenders.
  const lineRegex = /^[ \t]{0,3}##\s+(.+?)\s*$/gm;
  const matches: Array<{ index: number; title: string; lineEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(body))) {
    const lineEnd = body.indexOf("\n", m.index);
    matches.push({
      index: m.index,
      title: m[1],
      lineEnd: lineEnd === -1 ? body.length : lineEnd + 1,
    });
  }
  if (matches.length === 0) return [];
  return materialisePages(body, offset, matches);
}

// ---------------------------------------------------------------------------
// Structural path #2 — markdown H1 fallback (only when ≥ 2 H1s).
// ---------------------------------------------------------------------------

function parseByH1(body: string, offset: number): BriefPageDraft[] {
  // UAT (2026-05-03 round-3): same leading-whitespace tolerance as
  // parseByH2. CommonMark §4.2 allows 0-3 spaces before an ATX heading.
  const lineRegex = /^[ \t]{0,3}#\s+(.+?)\s*$/gm;
  const matches: Array<{ index: number; title: string; lineEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(body))) {
    const lineEnd = body.indexOf("\n", m.index);
    matches.push({
      index: m.index,
      title: m[1],
      lineEnd: lineEnd === -1 ? body.length : lineEnd + 1,
    });
  }
  if (matches.length < 2) return [];
  return materialisePages(body, offset, matches);
}

// ---------------------------------------------------------------------------
// Structural path #3 — horizontal-rule separator.
// ---------------------------------------------------------------------------

function parseByHrule(body: string, offset: number): BriefPageDraft[] {
  // Split on a line that is exactly `---` or `***` with optional whitespace.
  const hruleRegex = /^[ \t]*(?:-{3,}|\*{3,})[ \t]*$/gm;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = hruleRegex.exec(body))) {
    positions.push(m.index);
  }
  if (positions.length === 0) return [];

  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const pos of positions) {
    if (pos > cursor) segments.push({ start: cursor, end: pos });
    const after = body.indexOf("\n", pos);
    cursor = after === -1 ? body.length : after + 1;
  }
  if (cursor < body.length) segments.push({ start: cursor, end: body.length });

  const pages: BriefPageDraft[] = [];
  let ordinal = 0;
  for (const seg of segments) {
    const text = body.slice(seg.start, seg.end).trim();
    if (text.length === 0) continue;
    // First non-empty line is the title; rest is the source_text.
    const firstLineEnd = text.indexOf("\n");
    const title = (firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)).trim();
    const rest = firstLineEnd === -1 ? "" : text.slice(firstLineEnd + 1).trim();
    const sourceText = rest.length > 0 ? rest : text;
    const wordCount = countWords(sourceText);
    pages.push({
      ordinal: ordinal++,
      title: title.replace(/^#+\s*/, "") || `Section ${ordinal}`,
      mode: inferMode(wordCount),
      source_text: sourceText,
      word_count: wordCount,
      source_span_start: offset + seg.start,
      source_span_end: offset + seg.end,
    });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Structural path #4 — "Page N: <title>" numbered headers.
// ---------------------------------------------------------------------------

function parseByNumbered(body: string, offset: number): BriefPageDraft[] {
  const lineRegex = /^Page\s+\d+\s*:\s*(.+?)\s*$/gim;
  const matches: Array<{ index: number; title: string; lineEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(body))) {
    const lineEnd = body.indexOf("\n", m.index);
    matches.push({
      index: m.index,
      title: m[1],
      lineEnd: lineEnd === -1 ? body.length : lineEnd + 1,
    });
  }
  if (matches.length === 0) return [];
  return materialisePages(body, offset, matches);
}

// Given delimiter-style matches (every match line is a page break), slice
// the body into per-page segments.
function materialisePages(
  body: string,
  offset: number,
  matches: Array<{ index: number; title: string; lineEnd: number }>,
): BriefPageDraft[] {
  const pages: BriefPageDraft[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const sectionText = body.slice(cur.lineEnd, nextStart).trim();
    const wordCount = countWords(sectionText);
    pages.push({
      ordinal: i,
      title: cur.title,
      mode: inferMode(wordCount),
      source_text: sectionText,
      word_count: wordCount,
      source_span_start: offset + cur.index,
      source_span_end: offset + nextStart,
    });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Claude-inference fallback.
// ---------------------------------------------------------------------------

type InferenceEntry = {
  title: string;
  source_quote: string;
  mode?: BriefPageMode;
};

function briefInferenceIdempotencyKey(briefId: string, sourceSha256: string): string {
  return createHash("sha256")
    .update(`brief-parse:${briefId}:${sourceSha256}`)
    .digest("hex");
}

export function buildInferencePrompt(source: string): {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
} {
  const system = [
    "You are a parser that splits a client's website brief into an ordered page list.",
    "The operator will review every page you return before any generation runs,",
    "so precision matters more than creativity.",
    "",
    "Return a JSON array. Each entry is an object with exactly these keys:",
    '  "title":        short page title (string, ≤ 100 chars).',
    '  "source_quote": a VERBATIM substring from <brief_document> that is ≥ 50 characters.',
    '  "mode":         "full_text" if the brief already contains the complete copy for this page,',
    '                  "short_brief" if the brief only sketches it. Default to "short_brief" if unsure.',
    "",
    "Rules:",
    "- Return only valid JSON. No prose. No markdown fences.",
    "- Every source_quote MUST appear verbatim in <brief_document>.",
    "- Do not invent pages. If you cannot find structure, return an empty array [].",
    "- Preserve the document's own ordering.",
  ].join("\n");

  const user = [
    "<brief_document>",
    source,
    "</brief_document>",
  ].join("\n");

  return {
    system,
    messages: [{ role: "user", content: user }],
  };
}

function parseInferenceJson(raw: string): InferenceEntry[] | null {
  const trimmed = raw.trim();
  // Tolerate a single fenced block if the model ignores the instruction.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/m.exec(trimmed);
  const text = fenced ? fenced[1] : trimmed;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const out: InferenceEntry[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object") {
        const title = (entry as { title?: unknown }).title;
        const source_quote = (entry as { source_quote?: unknown }).source_quote;
        const mode = (entry as { mode?: unknown }).mode;
        if (typeof title === "string" && typeof source_quote === "string") {
          out.push({
            title,
            source_quote,
            mode: mode === "full_text" || mode === "short_brief" ? mode : undefined,
          });
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}

async function runInferenceFallback(opts: {
  briefId: string;
  source: string;
  sourceSha256: string;
  anthropicCall: AnthropicCallFn;
}): Promise<{ pages: BriefPageDraft[]; warnings: ParserWarning[] }> {
  const { briefId, source, sourceSha256, anthropicCall } = opts;
  const prompt = buildInferencePrompt(source);

  const response = await anthropicCall({
    model: INFERENCE_MODEL,
    max_tokens: INFERENCE_MAX_TOKENS,
    system: prompt.system,
    messages: prompt.messages,
    idempotency_key: briefInferenceIdempotencyKey(briefId, sourceSha256),
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const entries = parseInferenceJson(raw);
  if (!entries) {
    logger.warn("brief-parser.inference.parse_failed", {
      brief_id: briefId,
      raw_preview: raw.slice(0, 200),
    });
    return { pages: [], warnings: [] };
  }

  const warnings: ParserWarning[] = [];
  const pages: BriefPageDraft[] = [];

  // Locate each source_quote in the source text. Drop entries we can't
  // find; keep positions so we can derive source_text.
  const located: Array<{ entry: InferenceEntry; start: number; end: number }> = [];
  for (const entry of entries) {
    if (entry.source_quote.length < MIN_INFERENCE_QUOTE_CHARS) {
      warnings.push({
        code: "INFERENCE_ENTRY_DROPPED",
        detail: `"${entry.title}": source_quote shorter than ${MIN_INFERENCE_QUOTE_CHARS} chars.`,
      });
      continue;
    }
    const start = source.indexOf(entry.source_quote);
    if (start === -1) {
      warnings.push({
        code: "INFERENCE_ENTRY_DROPPED",
        detail: `"${entry.title}": source_quote not found in document.`,
      });
      continue;
    }
    located.push({ entry, start, end: start + entry.source_quote.length });
  }

  // Stable-sort by start offset so we preserve document order even if
  // Claude reordered. Build source_text as the slice from this entry's
  // start through the next entry's start (or EOF).
  located.sort((a, b) => a.start - b.start);
  for (let i = 0; i < located.length; i++) {
    const { entry, start } = located[i];
    const nextStart = i + 1 < located.length ? located[i + 1].start : source.length;
    const sectionText = source.slice(start, nextStart).trim();
    const wordCount = countWords(sectionText);
    pages.push({
      ordinal: i,
      title: entry.title.slice(0, 200),
      mode: entry.mode ?? inferMode(wordCount),
      source_text: sectionText,
      word_count: wordCount,
      source_span_start: start,
      source_span_end: nextStart,
    });
  }

  return { pages, warnings };
}

// ---------------------------------------------------------------------------
// parseBriefDocument — top-level entry point.
//
// The caller supplies the raw source + pre-computed sha256 (so the same
// digest is used for the idempotency key on the Anthropic call as the
// `briefs.source_sha256` column). `anthropicCall` is dependency-injected
// so tests can stub the Claude call without hitting the real API.
// ---------------------------------------------------------------------------

export async function parseBriefDocument(opts: {
  briefId: string;
  source: string;
  sourceSha256: string;
  anthropicCall?: AnthropicCallFn;
}): Promise<BriefParseResult> {
  const { briefId, source, sourceSha256 } = opts;
  const anthropicCall = opts.anthropicCall ?? defaultAnthropicCall;

  if (source.trim().length === 0) {
    return {
      ok: false,
      code: "EMPTY_DOCUMENT",
      detail: "Brief document is empty or whitespace-only.",
      warnings: [],
    };
  }

  const warnings: ParserWarning[] = [];
  const fenceWarning = detectUnclosedFence(source);
  if (fenceWarning) warnings.push(fenceWarning);

  const { body, offset, warning: frontmatterWarning } = stripFrontmatter(source);
  if (frontmatterWarning) warnings.push(frontmatterWarning);

  // Structural-first. Order matters: H2 → H1-fallback → hrule → numbered.
  const attempts: Array<{ path: string; pages: BriefPageDraft[] }> = [
    { path: "h2", pages: parseByH2(body, offset) },
    { path: "h1", pages: parseByH1(body, offset) },
    { path: "hrule", pages: parseByHrule(body, offset) },
    { path: "numbered", pages: parseByNumbered(body, offset) },
  ];

  for (const attempt of attempts) {
    if (attempt.pages.length > 0) {
      return {
        ok: true,
        parser_mode: "structural",
        pages: attempt.pages,
        warnings,
      };
    }
  }

  // Claude-inference fallback.
  logger.info("brief-parser.inference.start", { brief_id: briefId });
  const inference = await runInferenceFallback({
    briefId,
    source,
    sourceSha256,
    anthropicCall,
  });
  warnings.push(...inference.warnings);

  if (inference.pages.length > 0) {
    return {
      ok: true,
      parser_mode: "claude_inference",
      pages: inference.pages,
      warnings,
    };
  }

  // UAT (2026-05-03) — single-page fallback. Operators don't always type
  // briefs with formal page boundaries; sometimes a brief is just three
  // paragraphs of "build me a homepage about X for SMBs". When the
  // structural parser AND the Claude-inference fallback both fail to
  // find page boundaries, treat the entire document as a single page.
  // The page title comes from a leading heading if one exists, else the
  // first non-empty line trimmed to 60 chars, else "Untitled page".
  // Mode is short_brief vs full_text per the same word-count threshold
  // as the structural path.
  //
  // UAT round-3 polish (2026-05-03): when the single-page fallback fires,
  // strip the noisy tier-2 (Claude inference) warnings. Those warnings
  // describe partial failures of an earlier tier whose output we just
  // discarded; surfacing them on the review page makes the review look
  // alarmist when the final result is fine. Keep only structural-parser
  // warnings (tier 1) and append the single-page fallback note.
  const trimmed = source.trim();
  if (trimmed.length > 0) {
    const inferredTitle = inferTitleFromBlob(trimmed);
    const wordCount = countWords(trimmed);
    const mode: BriefPageMode =
      wordCount >= FULL_TEXT_WORD_THRESHOLD ? "full_text" : "short_brief";
    // Strip tier-2 inference warnings — the inference output didn't land,
    // its warnings are noise on the operator-visible review page.
    const inferenceWarningCodes: ReadonlyArray<ParserWarning["code"]> = [
      "INFERENCE_ENTRY_DROPPED",
    ];
    for (let i = warnings.length - 1; i >= 0; i--) {
      if (inferenceWarningCodes.includes(warnings[i].code)) {
        warnings.splice(i, 1);
      }
    }
    warnings.push({
      code: "HEADING_HIERARCHY_SKIPPED",
      detail:
        "No page boundaries were detected, so the whole document was treated as a single page. You can rename this page on the review form before committing.",
    });
    logger.info("brief-parser.single_page_fallback", {
      brief_id: briefId,
      word_count: wordCount,
      title: inferredTitle,
    });
    return {
      ok: true,
      parser_mode: "claude_inference",
      pages: [
        {
          ordinal: 0,
          title: inferredTitle,
          mode,
          source_text: trimmed,
          word_count: wordCount,
          source_span_start: 0,
          source_span_end: trimmed.length,
        },
      ],
      warnings,
    };
  }

  return {
    ok: false,
    code: "INFERENCE_FALLBACK_FAILED",
    detail: "Claude returned no valid page entries for this document.",
    warnings,
  };
}

function inferTitleFromBlob(text: string): string {
  // Prefer markdown headings: # / ## / ### lines anywhere in the doc.
  const headingMatch = text.match(/^\s{0,3}#{1,3}\s+(.+)$/m);
  if (headingMatch) {
    const title = headingMatch[1].trim().slice(0, 60);
    if (title.length > 0) return title;
  }
  // Fall back to the first non-empty line, trimmed.
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine && firstLine.length > 0) {
    return firstLine.slice(0, 60);
  }
  return "Untitled page";
}
