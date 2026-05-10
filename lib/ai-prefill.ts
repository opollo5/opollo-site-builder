// Server-only module — do not import in client components.

import Anthropic from "@anthropic-ai/sdk";

import { logger } from "@/lib/logger";
import { traceAnthropicCall } from "@/lib/langfuse";

export const CHAR_LIMIT = 20_000;
const MODEL = "claude-haiku-4-5-20251001";

export interface TaxonomyMatch {
  name: string;
  isNew: boolean;
}

export interface ExtractResult {
  title: string | null;
  content: string;
  seo_title: string | null;
  meta_description: string | null;
  slug: string | null;
  categories: TaxonomyMatch[];
  tags: TaxonomyMatch[];
  excerpt: string | null;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Primitive helpers — all exported for unit testing.
// ---------------------------------------------------------------------------

export function normalizeTags(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ""))
    .filter((t) => t.length > 0);
}

export function urlToSlug(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const parts = withoutQuery.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? "";
}

export function matchTaxonomy(
  name: string,
  available: string[],
): TaxonomyMatch {
  const lower = name.toLowerCase();
  const match = available.find((a) => a.toLowerCase() === lower);
  return match !== undefined ? { name: match, isNew: false } : { name, isNew: true };
}

// ---------------------------------------------------------------------------
// Deterministic pipe-table pre-extractor.
// ---------------------------------------------------------------------------

const METADATA_QUALIFIERS = new Set([
  "seo title",
  "seo meta description",
  "category",
  "tags",
  "url",
]);

function stripBold(s: string): string {
  return s.replace(/\*\*/g, "").trim();
}

function parsePipeRow(line: string): string[] {
  const cells = line.split("|");
  if (cells[0]?.trim() === "") cells.shift();
  if (cells[cells.length - 1]?.trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

export function parseMarkdownTable(
  markdown: string,
  availableCategories: string[],
  availableTags: string[],
): ExtractResult | null {
  const lines = markdown.split(/\r?\n/);

  // Skip leading blank lines and find first pipe-table line.
  let tableStart = 0;
  while (tableStart < lines.length && (lines[tableStart] ?? "").trim() === "") {
    tableStart++;
  }
  if (tableStart >= lines.length || !(lines[tableStart] ?? "").trim().startsWith("|")) {
    return null;
  }

  // Collect all consecutive pipe-table rows.
  let i = tableStart;
  const tableLines: string[] = [];
  while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
    tableLines.push(lines[i] ?? "");
    i++;
  }

  // Parse cells into label→value map.
  const labelMap: Record<string, string> = {};
  for (const line of tableLines) {
    const cells = parsePipeRow(line);
    // Skip separator rows (all cells are --- or ===).
    if (cells.every((c) => /^[-=]+$/.test(c))) continue;
    // Walk pairs.
    for (let ci = 0; ci + 1 < cells.length; ci += 2) {
      const rawLabel = cells[ci] ?? "";
      const rawValue = cells[ci + 1] ?? "";
      const label = stripBold(rawLabel).toLowerCase();
      const value = stripBold(rawValue);
      if (label.length > 0) {
        labelMap[label] = value;
      }
    }
  }

  // Require ≥3 qualifying labels.
  let qualCount = 0;
  for (const q of METADATA_QUALIFIERS) {
    if (q in labelMap) qualCount++;
  }
  if (qualCount < 3) return null;

  // Extract metadata fields.
  const rawSeoTitle = labelMap["seo title"] ?? null;
  const rawMetaDesc = labelMap["seo meta description"] ?? null;
  const rawUrl = labelMap["url"] ?? null;
  const rawCategory = labelMap["category"] ?? null;
  const rawTags = labelMap["tags"] ?? null;

  const slug = rawUrl ? urlToSlug(rawUrl) || null : null;

  const categories: TaxonomyMatch[] =
    rawCategory && rawCategory.length > 0
      ? [matchTaxonomy(rawCategory, availableCategories)]
      : [];

  const rawTagNames = rawTags ? normalizeTags(rawTags) : [];
  const tags: TaxonomyMatch[] = rawTagNames.map((t) => matchTaxonomy(t, availableTags));

  // Body starts after the table (at line i).
  const bodyLines = lines.slice(i);

  // Skip leading blank lines in body.
  let bodyStart = 0;
  while (bodyStart < bodyLines.length && (bodyLines[bodyStart] ?? "").trim() === "") {
    bodyStart++;
  }

  // Find title: H1 > bold-only paragraph > first non-blank line.
  let title: string | null = null;
  let titleLineIdx = bodyStart;

  for (let bi = bodyStart; bi < bodyLines.length; bi++) {
    const line = (bodyLines[bi] ?? "").trim();
    if (line === "") continue;

    const h1Match = /^#+\s+(.+)/.exec(line);
    if (h1Match) {
      title = h1Match[1]?.trim() ?? null;
      titleLineIdx = bi;
      break;
    }

    const boldMatch = /^\*\*(.+)\*\*$/.exec(line);
    if (boldMatch) {
      title = boldMatch[1]?.trim() ?? null;
      titleLineIdx = bi;
      break;
    }

    // First non-blank line fallback.
    title = line;
    titleLineIdx = bi;
    break;
  }

  // Content = everything after the title line, trimmed.
  const afterTitle = bodyLines.slice(titleLineIdx + 1);
  let contentStart = 0;
  while (
    contentStart < afterTitle.length &&
    (afterTitle[contentStart] ?? "").trim() === ""
  ) {
    contentStart++;
  }
  const content = afterTitle.slice(contentStart).join("\n").trimEnd();

  return {
    title,
    content,
    seo_title: rawSeoTitle && rawSeoTitle.length > 0 ? rawSeoTitle : null,
    meta_description: rawMetaDesc && rawMetaDesc.length > 0 ? rawMetaDesc : null,
    slug,
    categories,
    tags,
    excerpt: null,
    truncated: false,
  };
}

// ---------------------------------------------------------------------------
// Anthropic call (non-streaming, structured JSON extraction).
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return (
    "You extract structured metadata and body content from blog drafts so " +
    "a CMS can prefill its form. Many documents begin with a metadata " +
    "pipe-table containing some or all of these labels: Client, Author, SEO " +
    "Title, Version, SEO Meta Description, URL, Target Keyword(s), " +
    "Category, Tags. When such a table is present, extract values from it. " +
    "Map to JSON keys: title, content, seo_title, meta_description, slug, " +
    "categories, tags, excerpt. IGNORE Client, Version, Target Keyword(s), " +
    "and Author rows entirely — they must not appear in the output. Tags " +
    "are written as '#tagA #tagB' — split on whitespace and strip the " +
    "leading '#', preserving original casing. Category is a single value " +
    "but output it as a one-element array. Slug comes from the URL row by " +
    "taking the final path segment after the last '/'. The blog title " +
    "appears after the metadata table — it may be an H1, a bold-only " +
    "paragraph, or simply the first non-blank line; pick the strongest cue " +
    "available. Body content begins at the paragraph AFTER the title and " +
    "runs to end of document; it MUST exclude the metadata table AND the " +
    "title line itself. If no metadata table is present, infer fields from " +
    "the body using ordinary heuristics. Match category and tag names " +
    "case-insensitively against the provided availableCategories and " +
    "availableTags lists; when a match exists, output the existing canonical " +
    "casing with isNew: false. Otherwise output the source casing with " +
    "isNew: true. Return ONLY a single JSON object matching the required " +
    "shape — no preamble, no commentary, no code fences."
  );
}

function isTaxonomyMatch(x: unknown): x is TaxonomyMatch {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>).name === "string" &&
    typeof (x as Record<string, unknown>).isNew === "boolean"
  );
}

function parseExtractResult(raw: unknown): ExtractResult {
  const r = raw as Record<string, unknown>;
  return {
    title: typeof r.title === "string" ? r.title : null,
    content: typeof r.content === "string" ? r.content : "",
    seo_title: typeof r.seo_title === "string" ? r.seo_title : null,
    meta_description:
      typeof r.meta_description === "string" ? r.meta_description : null,
    slug: typeof r.slug === "string" ? r.slug : null,
    categories: Array.isArray(r.categories) ? r.categories.filter(isTaxonomyMatch) : [],
    tags: Array.isArray(r.tags) ? r.tags.filter(isTaxonomyMatch) : [],
    excerpt: typeof r.excerpt === "string" ? r.excerpt : null,
    truncated: false,
  };
}

export async function callAnthropic(
  text: string,
  availableCategories: string[],
  availableTags: string[],
): Promise<ExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt();

  const userContent =
    `Document text:\n<document>\n${text}\n</document>\n\n` +
    `Available categories: ${JSON.stringify(availableCategories)}\n` +
    `Available tags: ${JSON.stringify(availableTags)}`;

  const span = traceAnthropicCall({
    name: "ai_prefill",
    metadata: { model: MODEL, input_chars: text.length },
    input: { text_chars: text.length, categories: availableCategories.length, tags: availableTags.length },
  });

  let msg: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    span.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }

  const responseText =
    msg.content[0]?.type === "text" ? msg.content[0].text : "{}";

  logger.info("ai_prefill.anthropic_complete", {
    model: MODEL,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
  });

  span.end({
    response_id: msg.id,
    model: msg.model,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cached_tokens:
      (msg.usage.cache_read_input_tokens ?? 0) +
      (msg.usage.cache_creation_input_tokens ?? 0),
    cost_cents: 0,
    output_text: responseText,
  });

  // Strip code fences the model may include despite the prompt.
  const stripped = responseText.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    logger.warn("ai_prefill.json_parse_failed", { snippet: stripped.slice(0, 200) });
    parsed = {};
  }

  return parseExtractResult(parsed);
}

// ---------------------------------------------------------------------------
// Top-level extraction entry point.
// ---------------------------------------------------------------------------

export async function extract(
  rawText: string,
  availableCategories: string[],
  availableTags: string[],
  isMarkdownOrText: boolean,
): Promise<ExtractResult> {
  const truncated = rawText.length > CHAR_LIMIT;
  const text = truncated ? rawText.slice(0, CHAR_LIMIT) : rawText;

  if (isMarkdownOrText) {
    const pre = parseMarkdownTable(text, availableCategories, availableTags);
    if (
      pre !== null &&
      pre.title !== null &&
      pre.seo_title !== null &&
      pre.meta_description !== null &&
      pre.categories.length >= 1 &&
      pre.tags.length >= 1
    ) {
      logger.info("ai_prefill.pre_extractor_hit", {
        title_chars: pre.title.length,
        categories: pre.categories.length,
        tags: pre.tags.length,
      });
      return { ...pre, truncated };
    }
  }

  const result = await callAnthropic(text, availableCategories, availableTags);
  return { ...result, truncated };
}
