// ---------------------------------------------------------------------------
// BP-1 — Blog-post smart-parser.
//
// Pure-logic helper that extracts post metadata from the operator's
// pasted content. Five sources, in priority order:
//
//   1. YAML front-matter   — `---\nkey: value\n...\n---` block at top
//   2. Inline labels       — `Title: ...` / `Slug: ...` lines at top
//   3. HTML meta tags      — <title>, <meta name="description">,
//                            <link rel="canonical">
//   4. First H1            — <h1> or `# heading` markdown
//   5. First paragraph     — first non-empty, non-heading block,
//                            capped at 160 chars (meta_description)
//
// Each field tracks its source via `source_map` so the UI can render
// "Auto-filled from YAML title" hints. Operator can always edit.
//
// No DB. No network. No DOM. Run as often as you like (BP-3 calls
// it on every textarea change, debounced 200ms).
// ---------------------------------------------------------------------------

export type ParseSource =
  | "yaml"
  | "inline"
  | "html"
  | "h1"
  | "first_paragraph"
  | "derived"
  | "none";

export interface BlogPostMetadata {
  title: string | null;
  slug: string | null;
  meta_title: string | null;
  meta_description: string | null;
  source_map: {
    title: ParseSource;
    slug: ParseSource;
    meta_title: ParseSource;
    meta_description: ParseSource;
  };
}

const META_DESCRIPTION_CAP = 160;

// Slugify a title to URL-safe kebab-case. ASCII only — non-ASCII chars
// strip out (operator can override). Caps at 60 chars.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

// Trim a string to a max length on the nearest word boundary, then
// append "…" if truncation happened. The cap counts pre-ellipsis chars.
function truncateAtWord(input: string, max: number): string {
  const trimmed = input.trim();
  if (trimmed.length <= max) return trimmed;
  const window = trimmed.slice(0, max);
  const lastSpace = window.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? lastSpace : max;
  return `${window.slice(0, cut).trimEnd()}…`;
}

interface YamlBlock {
  body: string;
  rest: string;
}

// Extract the first --- ... --- block at the very top of the input.
// We deliberately accept only the constrained `key: value` shape; nested
// objects / arrays / multi-line strings are out of scope for v1.
function extractYamlBlock(text: string): YamlBlock | null {
  const trimmed = text.replace(/^\s+/, "");
  if (!trimmed.startsWith("---")) return null;
  // Anchor the closing --- on its own line.
  const after = trimmed.slice(3);
  const closeMatch = after.match(/\r?\n---\r?\n?/);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const body = after.slice(0, closeMatch.index);
  const rest = after.slice(closeMatch.index + closeMatch[0].length);
  return { body, rest };
}

function parseYamlKvBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    let value = line.slice(colon + 1).trim();
    // Strip matched surrounding quotes (single or double).
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0 && value.length > 0) out[key] = value;
  }
  return out;
}

const INLINE_LABEL_KEYS = new Set([
  "title",
  "slug",
  "meta title",
  "meta_title",
  "seo title",
  "meta description",
  "meta_description",
  "seo description",
  "description",
]);

function normalizeLabelKey(key: string): string | null {
  const lower = key.trim().toLowerCase();
  if (!INLINE_LABEL_KEYS.has(lower)) return null;
  if (lower === "meta title" || lower === "seo title") return "meta_title";
  if (
    lower === "meta description" ||
    lower === "seo description" ||
    lower === "description"
  ) {
    return "meta_description";
  }
  return lower;
}

function parseInlineLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "") {
      // Blank line — only treat the leading run as labels.
      if (Object.keys(out).length > 0) break;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z _]+):\s*(.+)$/.exec(line);
    if (!match) {
      if (Object.keys(out).length > 0) break;
      continue;
    }
    const [, rawKey = "", rawValue = ""] = match;
    const key = normalizeLabelKey(rawKey);
    if (!key) {
      // First non-label line ends the inline-labels block.
      if (Object.keys(out).length > 0) break;
      continue;
    }
    out[key] = rawValue.trim();
  }
  return out;
}

interface HtmlMeta {
  title?: string;
  description?: string;
  canonical?: string;
}

function parseHtmlMeta(text: string): HtmlMeta {
  const out: HtmlMeta = {};
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (titleMatch?.[1]) out.title = decodeHtmlEntities(titleMatch[1].trim());
  const descMatch =
    /<meta[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i.exec(
      text,
    ) ??
    /<meta[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']description["'][^>]*>/i.exec(
      text,
    );
  if (descMatch?.[1]) out.description = decodeHtmlEntities(descMatch[1].trim());
  const canonMatch =
    /<link[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/i.exec(
      text,
    ) ??
    /<link[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.exec(
      text,
    );
  if (canonMatch?.[1]) out.canonical = canonMatch[1].trim();
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractFirstH1(text: string): string | null {
  const htmlMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text);
  if (htmlMatch?.[1]) {
    return decodeHtmlEntities(htmlMatch[1].replace(/<[^>]+>/g, "").trim());
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) return line.slice(2).trim();
    if (line.startsWith("#")) {
      const rest = line.replace(/^#+/, "").trim();
      if (rest.length > 0) return rest;
    }
  }
  return null;
}

function extractFirstParagraph(text: string): string | null {
  // Strip an HTML/markdown H1 block if it leads.
  const stripped = text
    .replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "")
    .replace(/^\s*#[^\n]*\n+/, "");
  // Take the first non-empty, non-heading paragraph.
  const blocks = stripped.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const cleaned = block.replace(/<[^>]+>/g, "").trim();
    if (cleaned === "") continue;
    if (cleaned.startsWith("#")) continue;
    return cleaned.replace(/\s+/g, " ");
  }
  return null;
}

// Strip the YAML block (if any) and any leading inline-label block from
// `text`, so the H1 / first-paragraph fallbacks see only the body.
function stripPrelude(text: string): string {
  const yaml = extractYamlBlock(text);
  let body = yaml ? yaml.rest : text;
  // Walk past any inline-label lines at the top.
  const lines = body.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    const match = /^([A-Za-z][A-Za-z _]+):\s*(.+)$/.exec(line);
    if (!match) break;
    const key = normalizeLabelKey(match[1] ?? "");
    if (!key) break;
  }
  body = lines.slice(i).join("\n").replace(/^\s+/, "");
  return body;
}

export function parseBlogPostMetadata(text: string): BlogPostMetadata {
  const yamlBlock = extractYamlBlock(text);
  const yaml = yamlBlock ? parseYamlKvBlock(yamlBlock.body) : {};
  const inline = parseInlineLabels(yamlBlock ? yamlBlock.rest : text);
  const html = parseHtmlMeta(text);
  const body = stripPrelude(text);
  const h1 = extractFirstH1(body);
  const firstPara = extractFirstParagraph(body);

  // Resolve each field independently, recording the winning source.
  const out: BlogPostMetadata = {
    title: null,
    slug: null,
    meta_title: null,
    meta_description: null,
    source_map: {
      title: "none",
      slug: "none",
      meta_title: "none",
      meta_description: "none",
    },
  };

  // Title: yaml > inline > html.title > first H1.
  if (yaml.title) {
    out.title = yaml.title;
    out.source_map.title = "yaml";
  } else if (inline.title) {
    out.title = inline.title;
    out.source_map.title = "inline";
  } else if (html.title) {
    out.title = html.title;
    out.source_map.title = "html";
  } else if (h1) {
    out.title = h1;
    out.source_map.title = "h1";
  }

  // Slug: yaml > inline > html.canonical (last path segment) > derived.
  if (yaml.slug) {
    out.slug = slugify(yaml.slug);
    out.source_map.slug = "yaml";
  } else if (inline.slug) {
    out.slug = slugify(inline.slug);
    out.source_map.slug = "inline";
  } else if (html.canonical) {
    try {
      const url = new URL(html.canonical);
      const seg = url.pathname.split("/").filter(Boolean).pop();
      if (seg) {
        out.slug = slugify(seg);
        out.source_map.slug = "html";
      }
    } catch {
      // Malformed canonical URL — fall through to derived.
    }
  }
  if (out.slug === null && out.title) {
    const derived = slugify(out.title);
    if (derived.length > 0) {
      out.slug = derived;
      out.source_map.slug = "derived";
    }
  }

  // Meta title: yaml.meta_title > inline.meta_title > yaml/inline title fallback.
  if (yaml.meta_title) {
    out.meta_title = yaml.meta_title;
    out.source_map.meta_title = "yaml";
  } else if (inline.meta_title) {
    out.meta_title = inline.meta_title;
    out.source_map.meta_title = "inline";
  } else if (out.title) {
    out.meta_title = out.title;
    out.source_map.meta_title = "derived";
  }

  // Meta description: yaml > inline > html.description > first paragraph.
  if (yaml.meta_description) {
    out.meta_description = truncateAtWord(
      yaml.meta_description,
      META_DESCRIPTION_CAP,
    );
    out.source_map.meta_description = "yaml";
  } else if (inline.meta_description) {
    out.meta_description = truncateAtWord(
      inline.meta_description,
      META_DESCRIPTION_CAP,
    );
    out.source_map.meta_description = "inline";
  } else if (html.description) {
    out.meta_description = truncateAtWord(
      html.description,
      META_DESCRIPTION_CAP,
    );
    out.source_map.meta_description = "html";
  } else if (firstPara) {
    out.meta_description = truncateAtWord(firstPara, META_DESCRIPTION_CAP);
    out.source_map.meta_description = "first_paragraph";
  }

  return out;
}
