import "server-only";

// DESIGN-DISCOVERY — CSS / HTML scraping.
//
// Fetches an HTML document and pulls a small amount of design signal
// out: hex / rgb colors, font-family declarations, and a quick layout
// heuristic ("dark theme" / "card grid" / "full-width hero"). This is
// the cheap fallback when Microlink is unavailable, and the primary
// signal when the operator pastes a reference URL. The Claude vision
// pass on uploaded screenshots produces stronger signals (PR 5).
//
// We do NOT execute CSS or fetch linked stylesheets — that would mean
// running a browser. We scan the inline <style> blocks + the response
// HTML for color / font literals and do a layout-keyword heuristic on
// the markup itself. Cheap and good enough for v1.

const HEX_COLOR_RE = /#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_COLOR_RE = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}\n]+)/gi;
const LINK_HREF_RE = /<link[^>]+rel\s*=\s*["']?stylesheet["']?[^>]*href\s*=\s*["']([^"']+)["']/gi;

export interface CssExtractionResult {
  swatches: string[];
  fonts: string[];
  layout_tags: string[];
  visual_tone_tags: string[];
  fetched_url: string;
  fetch_ok: boolean;
  fetch_error: string | null;
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  ms: number,
): Promise<Response | { error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Some hosts (Cloudflare, AWS WAF) reject default fetch UA.
        "user-agent":
          "Opollo-Site-Builder/1.0 (+https://opollo.com) Design-Discovery",
      },
    });
    return res;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseFontFamilies(css: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = FONT_FAMILY_RE.exec(css))) {
    const list = m[1] ?? "";
    for (const raw of list.split(",")) {
      const cleaned = raw
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/!important$/, "")
        .trim();
      if (
        cleaned &&
        !/^var\(/.test(cleaned) &&
        !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset)$/i.test(
          cleaned,
        )
      ) {
        out.add(cleaned);
      }
    }
    if (out.size >= 6) break;
  }
  return [...out].slice(0, 4);
}

function parseColors(text: string): string[] {
  const tally = new Map<string, number>();
  const consider = (raw: string) => {
    const k = raw.toLowerCase();
    tally.set(k, (tally.get(k) ?? 0) + 1);
  };
  let m: RegExpExecArray | null;
  while ((m = HEX_COLOR_RE.exec(text))) consider(m[0]);
  while ((m = RGB_COLOR_RE.exec(text))) consider(m[0]);
  // Reset state — RegExp.exec is stateful with the /g flag.
  HEX_COLOR_RE.lastIndex = 0;
  RGB_COLOR_RE.lastIndex = 0;
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  // Drop pure white + pure black + transparent — they're noise.
  const filtered = sorted.filter(
    ([k]) =>
      k !== "#fff" &&
      k !== "#ffffff" &&
      k !== "#000" &&
      k !== "#000000" &&
      !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*0\b)/.test(k),
  );
  return filtered.slice(0, 8).map(([k]) => k);
}

function detectLayoutTags(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  if (/<section[^>]*class="[^"]*hero/i.test(html) || /class="[^"]*hero/i.test(html)) {
    out.push("Full-width hero");
  }
  if (
    /<div[^>]*class="[^"]*(card|grid)/i.test(html) ||
    /grid-template/.test(html)
  ) {
    out.push("Card grid");
  }
  if (/<form/i.test(html) && /(subscribe|newsletter|cta)/i.test(html)) {
    out.push("Inline CTA form");
  }
  if (/<footer/i.test(html)) {
    out.push("Footer");
  }
  if (
    lower.includes("dark") ||
    /background[^;]*#0|background[^;]*#1[0-9a-f]/.test(lower)
  ) {
    // Not authoritative but a useful prior; the visual_tone_tags step
    // can override.
    out.push("Dark theme");
  }
  return out.slice(0, 4);
}

function detectVisualToneTags(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  // Heuristics — fragile but cheap. The Claude vision step on
  // uploaded screenshots produces stronger signals.
  if (/whitespace|minimal|less is more/.test(lower)) out.push("Minimal");
  if (/premium|enterprise|world-class/.test(lower)) out.push("Premium");
  if (/(secure|cyber|threat|breach)/.test(lower)) out.push("Authoritative");
  if (/playful|friendly|delightful/.test(lower)) out.push("Friendly");
  if (/(technical|api|sdk|developer)/.test(lower)) out.push("Technical");
  return [...new Set(out)].slice(0, 4);
}

function normaliseUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export async function extractCssFromUrl(
  inputUrl: string,
): Promise<CssExtractionResult> {
  const url = normaliseUrl(inputUrl);
  const empty = (err: string | null): CssExtractionResult => ({
    swatches: [],
    fonts: [],
    layout_tags: [],
    visual_tone_tags: [],
    fetched_url: url,
    fetch_ok: false,
    fetch_error: err,
  });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return empty("Invalid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return empty("URL must use http:// or https://.");
  }

  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if ("error" in res) {
    return empty(res.error);
  }
  if (!res.ok) {
    return empty(`HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return empty(`Unexpected content-type: ${ct}`);
  }
  let html: string;
  try {
    html = await res.text();
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
  }

  // Reset regex state before extraction passes.
  LINK_HREF_RE.lastIndex = 0;

  const swatches = parseColors(html);
  const fonts = parseFontFamilies(html);
  const layout_tags = detectLayoutTags(html);
  const visual_tone_tags = detectVisualToneTags(html);

  return {
    swatches,
    fonts,
    layout_tags,
    visual_tone_tags,
    fetched_url: url,
    fetch_ok: true,
    fetch_error: null,
  };
}
