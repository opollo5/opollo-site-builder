// DESIGN-DISCOVERY — HTML normalization pass.
//
// Run on every generated concept before storing or rendering. The
// model is good at the structural constraints but tends to drift on
// magic numbers (px values not snapped to the 8px grid, font sizes
// outside the spec range, prose too long per line). We snap to the
// grid in post.
//
// On any unhandled error the caller logs and falls back to the
// un-normalised HTML — never block the operator on a normalisation
// edge case.

// Matches "padding: 12px 14px 6px 4px" (shorthand) AND "padding-top: 8px"
// (longhand). The body capture goes up to ; / } / " / newline so we can
// snap every px token in shorthand declarations.
const PX_DECL_RE = /(margin|padding)([a-z-]*)\s*:\s*([^;}"'\n]+)/gi;
const FONT_SIZE_RE = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)/gi;
const LINE_LENGTH_PROSE_RE = /max-width\s*:\s*(\d+)ch/gi;

const PADDING_GRID = 8;

function snapToGrid(value: number, grid: number): number {
  if (!Number.isFinite(value) || value <= 0) return grid;
  return Math.max(grid, Math.round(value / grid) * grid);
}

function clampFontSize(px: number, min: number, max: number): number {
  if (!Number.isFinite(px)) return Math.round((min + max) / 2);
  if (px < min) return min;
  if (px > max) return max;
  return Math.round(px);
}

export interface NormalizationResult {
  html: string;
  changed: boolean;
  warnings: string[];
}

export function normalizeConceptHtml(input: string): NormalizationResult {
  const warnings: string[] = [];
  let changed = false;
  let html = input;

  // 1. Snap margin/padding px values to the 8px grid. Multi-value
  //    shorthand ("12px 16px 0 4px") gets each token snapped. Tokens
  //    that don't end in `px` (like `0`, `auto`, `1em`) are preserved
  //    as-is.
  PX_DECL_RE.lastIndex = 0;
  html = html.replace(PX_DECL_RE, (full, prop: string, suffix: string, body: string) => {
    const trimmed = body.trim();
    if (!/\d+px\b/.test(trimmed)) return full;
    const tokens = trimmed.split(/\s+/);
    const snapped = tokens
      .map((t) => {
        const m = /^(\d+(?:\.\d+)?)px$/.exec(t);
        if (!m) return t;
        const n = parseFloat(m[1]!);
        return `${snapToGrid(n, PADDING_GRID)}px`;
      })
      .join(" ");
    if (snapped !== trimmed) {
      changed = true;
    }
    return `${prop}${suffix}: ${snapped}`;
  });

  // 2. Clamp font sizes that are clearly out of spec.
  //    Hero (.ls-hero h1, .ls-hero .headline): 48-72px desktop.
  //    H2 standalone: 28-36px.
  //    Body: 16-18px.
  // We can't reliably attribute every font-size to the right element
  // by regex alone — instead, clamp anything > 96px down to 72px,
  // and anything < 12px up to 14px (smallest tolerated body size).
  FONT_SIZE_RE.lastIndex = 0;
  html = html.replace(FONT_SIZE_RE, (full, sizeStr: string, unit: string) => {
    if (unit !== "px") return full;
    const px = parseFloat(sizeStr);
    if (!Number.isFinite(px)) return full;
    const clamped = clampFontSize(px, 12, 96);
    if (clamped !== px) {
      changed = true;
    }
    return `font-size: ${clamped}${unit}`;
  });

  // 3. Clamp prose max-width to <= 70ch.
  LINE_LENGTH_PROSE_RE.lastIndex = 0;
  html = html.replace(LINE_LENGTH_PROSE_RE, (full, chStr: string) => {
    const ch = parseInt(chStr, 10);
    if (!Number.isFinite(ch)) return full;
    if (ch > 70) {
      changed = true;
      return `max-width: 70ch`;
    }
    return full;
  });

  // 4. Strip <script> tags defensively even though the model is told
  //    not to emit them. Belt + braces.
  if (/<script\b/i.test(html)) {
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    warnings.push("stripped <script> tag(s)");
    changed = true;
  }

  return { html, changed, warnings };
}
