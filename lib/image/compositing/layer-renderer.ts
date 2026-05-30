/**
 * layer-renderer — server-side renderer for v2 layer-based templates.
 *
 * Design spec: docs/briefs/image-generator/v1.1/TEMPLATE_EDITOR_DESIGN_v3.md §6
 * Build brief: docs/briefs/image-generator/v2-editor/MASS_IMAGE_GEN_EDITOR_v2_BUILD_BRIEF.md E2
 *
 * Each exported render function accepts a typed layer and returns a
 * sharp.OverlayOptions so the caller can composite it onto the canvas.
 *
 * Text measurement uses a per-character advance-width table derived from the
 * Inter Regular font metrics (the primary bundled font). All five bundled
 * families use similar Latin metrics; the table gives deterministic,
 * font-aware measurement without a runtime font-parsing dependency.
 * The golden-image suite (E7) validates parity against the DOM renderer.
 *
 * Slice coverage:
 *   E2 — text layer: text-fit, secondary style parser, glyph-hugging bg
 *   E3 — image layer: asset resolver, fill/anchor, tint, border_radius, clip_path
 *   E4 — rectangle layer (added in separate slice)
 *   E5 — transforms: rotation, skew, opacity (added in separate slice)
 */

import "server-only";

import sharp from "sharp";

import { logger } from "@/lib/logger";
import type {
  TextLayer,
  TextAlignH,
  TextFitOptions,
  TextBackground,
  SecondaryStyle,
  ImageLayer,
  ImageAnchorX,
  ImageAnchorY,
  RectangleLayer,
  Gradient,
} from "@/lib/image/template-model";

// ─── Font face declarations (shared with sharp-renderer) ─────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FONTS_DIR = join(process.cwd(), "assets", "fonts");

function loadFont(filename: string): string | null {
  const p = join(FONTS_DIR, filename);
  if (!existsSync(p)) return null;
  return readFileSync(p).toString("base64");
}

interface FontPair { regular: string | null; bold: string | null }
const FONTS: Record<string, FontPair> = {
  Inter:        { regular: loadFont("Inter-Regular.woff2"),       bold: loadFont("Inter-Bold.woff2")       },
  Roboto:       { regular: loadFont("Roboto-Regular.woff2"),      bold: loadFont("Roboto-Bold.woff2")      },
  Montserrat:   { regular: loadFont("Montserrat-Regular.woff2"),  bold: loadFont("Montserrat-Bold.woff2")  },
  "Open Sans":  { regular: loadFont("OpenSans-Regular.woff2"),    bold: loadFont("OpenSans-Bold.woff2")    },
  Poppins:      { regular: loadFont("Poppins-Regular.woff2"),     bold: loadFont("Poppins-Bold.woff2")     },
};

const FONT_FACE_SVG = (() => {
  const rules: string[] = [];
  for (const [family, pair] of Object.entries(FONTS)) {
    if (pair.regular) {
      rules.push(`@font-face{font-family:'${family}';font-weight:400;src:url('data:font/woff2;base64,${pair.regular}')format('woff2');}`);
    }
    if (pair.bold) {
      rules.push(`@font-face{font-family:'${family}';font-weight:700;src:url('data:font/woff2;base64,${pair.bold}')format('woff2');}`);
    }
  }
  return rules.length > 0 ? `<defs><style>${rules.join("")}</style></defs>` : "";
})();

// ─── Text measurement (§7) ────────────────────────────────────────────────────

/**
 * Per-character advance-width ratios (advance_width / font_size) for Inter Regular.
 * Derived from Inter 4.0 UPM=2048 advance widths, normalised.
 * Used for both Inter and as an approximate baseline for other Latin fonts.
 * Characters outside the table fall back to AVERAGE_CHAR_RATIO.
 */
const CHAR_RATIO: Record<string, number> = {
  // space / punctuation
  " ": 0.250, ",": 0.278, ".": 0.278, ":": 0.278, ";": 0.278,
  "!": 0.278, "?": 0.444, "'": 0.222, '"': 0.361, "`": 0.278,
  "-": 0.333, "–": 0.556, "—": 1.000, "(": 0.333, ")": 0.333,
  "[": 0.333, "]": 0.333, "{": 0.333, "}": 0.333, "/": 0.389,
  "\\": 0.389, "|": 0.222, "@": 0.861, "#": 0.556, "$": 0.556,
  "%": 0.722, "&": 0.722, "*": 0.556, "+": 0.583, "=": 0.583,
  "<": 0.583, ">": 0.583,
  // lowercase
  a: 0.556, b: 0.556, c: 0.500, d: 0.556, e: 0.556, f: 0.278,
  g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.500, l: 0.222,
  m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333,
  s: 0.500, t: 0.333, u: 0.556, v: 0.500, w: 0.722, x: 0.500,
  y: 0.500, z: 0.500,
  // uppercase
  A: 0.667, B: 0.611, C: 0.667, D: 0.722, E: 0.611, F: 0.556,
  G: 0.722, H: 0.722, I: 0.278, J: 0.444, K: 0.667, L: 0.556,
  M: 0.833, N: 0.722, O: 0.778, P: 0.611, Q: 0.778, R: 0.667,
  S: 0.556, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667,
  Y: 0.611, Z: 0.611,
  // digits (tabular in Inter)
  "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556,
  "5": 0.556, "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556,
};

const AVERAGE_CHAR_RATIO = 0.550; // fallback for unmapped characters

/**
 * Measure the rendered width of a string in pixels.
 * Accounts for letter-spacing: each character (except the last) adds letterSpacing px.
 * Bold text uses ~1.05× wider glyphs on average (well-approximated for Latin).
 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
): number {
  if (!text) return 0;
  const boldFactor = fontWeight >= 700 ? 1.05 : 1.0;
  let width = 0;
  for (const ch of text) {
    const ratio = CHAR_RATIO[ch] ?? AVERAGE_CHAR_RATIO;
    width += ratio * fontSize * boldFactor;
  }
  // letter-spacing applies between characters (N-1 gaps for N chars)
  width += letterSpacing * Math.max(0, text.length - 1);
  return width;
}

/**
 * Word-wrap text to lines fitting within boxWidth pixels.
 * Greedy algorithm: pack words onto a line until the next word would overflow.
 * A word wider than boxWidth is kept as its own line (allowed to overflow per spec).
 */
export function wrapLayerText(
  text: string,
  boxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
  wordBreak: string = "normal",
): string[] {
  const TOL = 2; // px tolerance per §7
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let currentW = 0;
  const spaceW = measureTextWidth(" ", fontSize, fontWeight, 0);

  for (const word of words) {
    const wordW = measureTextWidth(word, fontSize, fontWeight, letterSpacing);
    if (!current) {
      current = word;
      currentW = wordW;
    } else {
      const candidateW = currentW + spaceW + wordW + letterSpacing;
      if (candidateW <= boxWidth + TOL) {
        current += ` ${word}`;
        currentW = candidateW;
      } else {
        lines.push(current);
        current = word;
        currentW = wordW;
      }
    }
  }
  if (current) lines.push(current);

  // break-all: break individual words if they overflow (already handled by greedy,
  // but honour the flag for single long words)
  if (wordBreak === "break-all" || wordBreak === "break-word") {
    return lines.flatMap((line) => {
      const lw = measureTextWidth(line, fontSize, fontWeight, letterSpacing);
      if (lw <= boxWidth + TOL) return [line];
      // hard-break: split character by character
      const result: string[] = [];
      let chunk = "";
      let chunkW = 0;
      for (const ch of line) {
        const cw = (CHAR_RATIO[ch] ?? AVERAGE_CHAR_RATIO) * fontSize + letterSpacing;
        if (chunkW + cw > boxWidth + TOL && chunk) {
          result.push(chunk);
          chunk = ch;
          chunkW = cw;
        } else {
          chunk += ch;
          chunkW += cw;
        }
      }
      if (chunk) result.push(chunk);
      return result;
    });
  }

  return lines.length > 0 ? lines : [""];
}

/**
 * Binary search for the largest integer font size in [min_size, max_size] such that
 * the wrapped text fits within box.width × box.height and within max_lines.
 * Implements design spec §7 exactly: max 20 iterations, 1-2px tolerance.
 */
export function fitFontSize(
  text: string,
  box: { width: number; height: number },
  opts: TextFitOptions,
  fontWeight: number,
  letterSpacing: number,
  lineHeight: number,
  wordBreak: string,
): number {
  const MAX_ITERS = 20;
  const TOL = 2; // px

  let lo = opts.min_size;
  let hi = opts.max_size;
  let best = lo;

  for (let i = 0; i < MAX_ITERS; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = wrapLayerText(text, box.width, mid, fontWeight, letterSpacing, wordBreak);
    const lineH = mid * lineHeight;
    const totalH = lines.length * lineH;

    const maxLineW = Math.max(...lines.map((l) => measureTextWidth(l, mid, fontWeight, letterSpacing)));

    const fitsWidth = maxLineW <= box.width + TOL;
    const fitsHeight = totalH <= box.height + TOL;
    const fitsLines = lines.length <= opts.max_lines;

    if (fitsWidth && fitsHeight && fitsLines) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }

    if (lo > hi) break;
  }

  return best;
}

// ─── Secondary style parser (§6.6, §1.7) ──────────────────────────────────────

export interface TextRun {
  text: string;
  secondary: boolean;
}

/**
 * Split a text string into normal and secondary runs.
 * Text wrapped in *asterisks* is marked secondary: true.
 * Parser must be identical across all renderers — do not diverge.
 *
 * "Mindset Shifts That *Matter*" →
 *   [{text:"Mindset Shifts That ",secondary:false},{text:"Matter",secondary:true}]
 */
export function parseSecondaryRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match: (normal text)(* secondary text *) pairs, plus trailing normal text.
  const re = /([^*]*)(?:\*([^*]*)\*)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // Guard against infinite loop at end-of-string
    if (match[0].length === 0) break;
    if (match[1]) runs.push({ text: match[1], secondary: false });
    if (match[2]) runs.push({ text: match[2], secondary: true });
  }
  return runs.filter((r) => r.text.length > 0);
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Text transform ────────────────────────────────────────────────────────────

function applyTextTransform(text: string, transform: string): string {
  switch (transform) {
    case "uppercase":    return text.toUpperCase();
    case "lowercase":    return text.toLowerCase();
    case "capitalize":   return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:             return text;
  }
}

// ─── Text layer SVG builder (§6.1, §6.5) ─────────────────────────────────────

interface SvgTextLayerOpts {
  width: number;
  height: number;
  layer: TextLayer;
}

/**
 * Build the SVG string for a text layer overlay.
 * The SVG is sized to the layer's width × height; sharp composites it at (x, y).
 * Transforms (rotation, skew) are applied by the caller in E5.
 */
export function buildTextLayerSvg(opts: SvgTextLayerOpts): string {
  const { width, height, layer } = opts;

  // 1. Apply text-transform to the full text before parsing or wrapping.
  const displayText = applyTextTransform(layer.text, layer.text_transform);

  // 2. Resolve font size (text-fit or fixed).
  const fontSize = layer.text_fit.enabled
    ? fitFontSize(
        displayText,
        { width, height },
        layer.text_fit,
        layer.font_weight,
        layer.letter_spacing,
        layer.line_height,
        layer.word_break,
      )
    : layer.font_size;

  // 3. Word-wrap the full text.
  const lines = wrapLayerText(
    displayText,
    width,
    fontSize,
    layer.font_weight,
    layer.letter_spacing,
    layer.word_break,
  );

  // 4. Vertical alignment: compute starting y.
  const lineH = fontSize * layer.line_height;
  const totalTextH = lines.length * lineH;
  let startY: number;
  switch (layer.text_align_v) {
    case "bottom": startY = height - totalTextH; break;
    case "center": startY = (height - totalTextH) / 2; break;
    default:       startY = 0;          // top
  }

  // 5. Horizontal anchor.
  const textAnchor = textAnchorFor(layer.text_align_h);
  const anchorX = xAnchorPx(layer.text_align_h, width);

  // 6. Font stack.
  const fontStack = `'${layer.font_family}',sans-serif`;
  const fontWeight = layer.font_weight;
  const letterSpacing = layer.letter_spacing;
  const textDecoration = layer.text_decoration === "none" ? "" : layer.text_decoration;

  // 7. Parse secondary runs (once per full text, then re-map per line).
  const allRuns = parseSecondaryRuns(displayText);

  // 8. Build SVG elements.
  const parts: string[] = [];

  // Glyph-hugging background: one rect per line.
  if (layer.background.color) {
    parts.push(...buildLineBackgrounds({
      lines,
      startY,
      lineH,
      fontSize,
      anchorX,
      alignH: layer.text_align_h,
      totalWidth: width,
      fontWeight,
      letterSpacing,
      bg: layer.background,
    }));
  }

  // Text lines.
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const baseline = startY + i * lineH + fontSize; // SVG text y is baseline
    const lineRuns = sliceRunsForLine(lineText, allRuns);

    if (lineRuns.length <= 1 && !lineRuns[0]?.secondary) {
      // Simple line — no secondary style.
      parts.push(
        `<text x="${anchorX}" y="${baseline.toFixed(1)}"` +
        ` text-anchor="${textAnchor}"` +
        ` font-family="${escapeXml(fontStack)}"` +
        ` font-size="${fontSize}"` +
        ` font-weight="${fontWeight}"` +
        ` fill="${escapeXml(layer.color)}"` +
        (letterSpacing ? ` letter-spacing="${letterSpacing}"` : "") +
        (textDecoration ? ` text-decoration="${textDecoration}"` : "") +
        (layer.direction !== "ltr" ? ` direction="${layer.direction}"` : "") +
        `>${escapeXml(lineText)}</text>`,
      );
    } else {
      // Mixed run line — use tspan per run.
      const tspans = lineRuns.map((run) => {
        const color = run.secondary
          ? (layer.secondary.color ?? layer.color)
          : layer.color;
        const fam = run.secondary && layer.secondary.font_family
          ? `'${layer.secondary.font_family}',sans-serif`
          : fontStack;
        return `<tspan fill="${escapeXml(color)}" font-family="${escapeXml(fam)}">${escapeXml(run.text)}</tspan>`;
      });
      parts.push(
        `<text x="${anchorX}" y="${baseline.toFixed(1)}"` +
        ` text-anchor="${textAnchor}"` +
        ` font-family="${escapeXml(fontStack)}"` +
        ` font-size="${fontSize}"` +
        ` font-weight="${fontWeight}"` +
        (letterSpacing ? ` letter-spacing="${letterSpacing}"` : "") +
        (textDecoration ? ` text-decoration="${textDecoration}"` : "") +
        (layer.direction !== "ltr" ? ` direction="${layer.direction}"` : "") +
        `>${tspans.join("")}</text>`,
      );
    }
  }

  return (
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    FONT_FACE_SVG +
    parts.join("") +
    `</svg>`
  );
}

// ─── Glyph-hugging line backgrounds (§6.5) ───────────────────────────────────

interface LineBgOpts {
  lines: string[];
  startY: number;
  lineH: number;
  fontSize: number;
  anchorX: number;
  alignH: TextAlignH;
  totalWidth: number;
  fontWeight: number;
  letterSpacing: number;
  bg: TextBackground;
}

function buildLineBackgrounds(opts: LineBgOpts): string[] {
  const { lines, startY, lineH, fontSize, anchorX, alignH, fontWeight, letterSpacing, bg } = opts;
  const padH = bg.padding_h ?? 0;
  const padV = bg.padding_v ?? 0;
  const radius = bg.radius ?? 0;
  const shift = bg.shift ?? 0;

  return lines.map((line, i) => {
    const lineW = measureTextWidth(line, fontSize, fontWeight, letterSpacing);
    const rectH = fontSize + padV * 2;
    const rectY = startY + i * lineH + shift - padV;
    let rectX: number;
    switch (alignH) {
      case "center": rectX = anchorX - lineW / 2 - padH; break;
      case "right":  rectX = anchorX - lineW - padH; break;
      default:       rectX = anchorX - padH;
    }
    const rectW = lineW + padH * 2;

    let rect = `<rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}"` +
      ` width="${rectW.toFixed(1)}" height="${rectH.toFixed(1)}"` +
      ` fill="${escapeXml(bg.color ?? "transparent")}"`;

    if (radius) rect += ` rx="${radius}" ry="${radius}"`;

    if (bg.border && bg.border_width) {
      rect += ` stroke="${escapeXml(bg.border)}" stroke-width="${bg.border_width}"`;
    }

    rect += "/>"; // self-closing
    return rect;
  });
}

// ─── Alignment helpers ────────────────────────────────────────────────────────

function textAnchorFor(alignH: TextAlignH): string {
  switch (alignH) {
    case "center":  return "middle";
    case "right":   return "end";
    case "justify": return "start"; // justify handled by space-between in DOM; SVG uses start
    default:        return "start";
  }
}

function xAnchorPx(alignH: TextAlignH, width: number): number {
  switch (alignH) {
    case "center":  return width / 2;
    case "right":   return width;
    case "justify": return 0;
    default:        return 0;
  }
}

// ─── Run-slicing helper ───────────────────────────────────────────────────────

/**
 * Given the full secondary-run parse and a single wrapped line's text,
 * produce the runs for just that line.
 * Strategy: we re-parse the line directly (secondary markers survive text-transform
 * since applyTextTransform is applied to the full string before parsing).
 */
function sliceRunsForLine(lineText: string, _allRuns: TextRun[]): TextRun[] {
  // Re-parse the line: secondary markers survive word-wrap since the wrap splits
  // on spaces, and asterisks are non-space characters.
  return parseSecondaryRuns(lineText);
}

// ─── Public render function ───────────────────────────────────────────────────

/**
 * Render a TextLayer into a sharp.OverlayOptions for compositing onto the canvas.
 * The overlay is positioned at the layer's (x, y) coordinates.
 *
 * E5 will add rotation + skew transforms around this function.
 */
export async function renderTextLayer(
  layer: TextLayer,
): Promise<sharp.OverlayOptions> {
  const svg = buildTextLayerSvg({
    width: layer.width,
    height: layer.height,
    layer,
  });

  // Validate SVG is non-empty before handing to sharp.
  if (!svg.includes("<text")) {
    logger.warn("image.layer-renderer.text.empty", { layerId: layer.id, name: layer.name });
  }

  const buf = Buffer.from(svg);

  // Convert SVG to PNG via sharp (librsvg) before returning, so the caller
  // can composite a raster overlay — SVG overlays only work if sharp was
  // compiled with librsvg support, which our build guarantees.
  const png = await sharp(buf).png().toBuffer();

  return {
    input: png,
    left: Math.round(layer.x),
    top: Math.round(layer.y),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// E3 — IMAGE LAYER (§3.4, §6.7)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Asset resolver (§1.4) ────────────────────────────────────────────────────

/**
 * Resolve the concrete image URL for an image layer.
 *
 * Resolution order: asset_id (looked up at render time) → image_url.
 * The full asset_id resolver is implemented in D-series once the assets
 * table exists. For now, asset_id is logged and image_url is used as
 * the fallback — no templates in V1 use asset_id yet.
 */
export async function resolveImageUrl(layer: ImageLayer): Promise<string | null> {
  if (layer.asset_id) {
    logger.warn("image.layer-renderer.image.asset_id_not_implemented", {
      layerId: layer.id,
      assetId: layer.asset_id,
      name: layer.name,
    });
  }
  return layer.image_url ?? null;
}

// ─── Anchor → sharp gravity ───────────────────────────────────────────────────

/**
 * Map ImageLayer anchor values to the sharp gravity/position string.
 * Used for both `cover` and `contain` (fit) resize modes.
 */
export function buildSharpPosition(anchorX: ImageAnchorX, anchorY: ImageAnchorY): string {
  const h = anchorX === "left" ? "west" : anchorX === "right" ? "east" : "";
  const v = anchorY === "top" ? "north" : anchorY === "bottom" ? "south" : "";
  if (v && h) return `${v}${h}`;   // e.g. "northwest"
  if (v) return v;                  // "north" / "south"
  if (h) return h;                  // "west" / "east"
  return "centre";                  // center/center
}

// ─── Masking helpers ──────────────────────────────────────────────────────────

/**
 * Apply a rounded-rectangle mask to clip an image to border_radius corners.
 * Uses SVG + `dest-in` composite (alpha masking).
 */
async function applyBorderRadiusMask(
  buf: Buffer,
  w: number,
  h: number,
  radius: number,
): Promise<Buffer> {
  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="white"/>` +
    `</svg>`,
  );
  const maskPng = await sharp(maskSvg).png().toBuffer();
  return sharp(buf).composite([{ input: maskPng, blend: "dest-in" }]).png().toBuffer();
}

/**
 * Apply an SVG clip-path mask to the image.
 * `clipPath` is an SVG path data string (e.g. a diagonal polygon).
 * Used for split-layout diagonal cuts.
 */
async function applyClipPathMask(
  buf: Buffer,
  w: number,
  h: number,
  clipPath: string,
): Promise<Buffer> {
  const maskSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${escapeXml(clipPath)}" fill="white"/>` +
    `</svg>`,
  );
  const maskPng = await sharp(maskSvg).png().toBuffer();
  return sharp(buf).composite([{ input: maskPng, blend: "dest-in" }]).png().toBuffer();
}

/**
 * Apply a multiply-blend tint overlay to an image.
 * tintColor is a CSS colour string (e.g. "#FF0000" or "rgba(0,0,255,0.5)").
 */
async function applyTint(buf: Buffer, w: number, h: number, tintColor: string): Promise<Buffer> {
  const tintSvg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${w}" height="${h}" fill="${escapeXml(tintColor)}"/>` +
    `</svg>`,
  );
  const tintPng = await sharp(tintSvg).png().toBuffer();
  return sharp(buf).composite([{ input: tintPng, blend: "multiply" }]).png().toBuffer();
}

// ─── Public render function ───────────────────────────────────────────────────

/**
 * Render an ImageLayer into a sharp.OverlayOptions for compositing.
 *
 * Pipeline:
 *   1. Resolve image URL (asset_id → image_url fallback)
 *   2. Fetch the image bytes
 *   3. Resize with fill mode + anchor gravity
 *   4. Apply clip_path mask (if set)
 *   5. Apply border_radius mask (if set)
 *   6. Apply tint overlay (if set)
 *
 * Returns null if no image URL is available and hide_when_empty should apply.
 * E5 adds rotation + skew transforms around this function.
 */
export async function renderImageLayer(
  layer: ImageLayer,
): Promise<sharp.OverlayOptions | null> {
  const url = await resolveImageUrl(layer);

  if (!url) {
    if (layer.hide_when_empty) return null;
    logger.warn("image.layer-renderer.image.no_url", { layerId: layer.id, name: layer.name });
    return null;
  }

  // 1. Fetch image bytes.
  let imgBuf: Buffer;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      logger.warn("image.layer-renderer.image.fetch_failed", {
        layerId: layer.id, status: resp.status, url,
      });
      return null;
    }
    imgBuf = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    logger.warn("image.layer-renderer.image.fetch_error", {
      layerId: layer.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // 2. Resize to layer dimensions with fill mode and anchor.
  const fit = layer.fill === "fit" ? "contain" : "cover";
  const position = buildSharpPosition(layer.anchor_x, layer.anchor_y);

  let buf = await sharp(imgBuf)
    .resize(layer.width, layer.height, { fit, position })
    .png()
    .toBuffer();

  // 3. Apply clip_path mask (before border_radius — clip first, round after).
  if (layer.clip_path) {
    buf = await applyClipPathMask(buf, layer.width, layer.height, layer.clip_path);
  }

  // 4. Apply border_radius mask.
  if (layer.border_radius > 0) {
    buf = await applyBorderRadiusMask(buf, layer.width, layer.height, layer.border_radius);
  }

  // 5. Apply tint overlay.
  if (layer.tint_color) {
    buf = await applyTint(buf, layer.width, layer.height, layer.tint_color);
  }

  return {
    input: buf,
    left: Math.round(layer.x),
    top: Math.round(layer.y),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// E4 — RECTANGLE LAYER (§3.5)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Gradient SVG builder ─────────────────────────────────────────────────────

function buildGradientDef(gradient: Gradient, w: number, h: number, id: string): string {
  const stops = gradient.stops
    .map((s) => `<stop offset="${(s.position * 100).toFixed(1)}%" stop-color="${escapeXml(s.color)}"/>`)
    .join("");

  if (gradient.type === "radial") {
    return `<radialGradient id="${id}" cx="50%" cy="50%" r="50%" gradientUnits="objectBoundingBox">${stops}</radialGradient>`;
  }

  // Linear gradient: angle 0 = top-to-bottom; rotate around the rect centre.
  const angle = gradient.angle ?? 0;
  const rad = (angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;

  // Compute gradient vector endpoints in SVG userSpaceOnUse coordinates.
  // A unit vector at `angle` degrees from top:
  //   angle=0   → top-to-bottom (x1=50%,y1=0,x2=50%,y2=100%)
  //   angle=90  → left-to-right
  //   angle=180 → bottom-to-top
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Half-diagonal of the bounding box
  const d = Math.sqrt(cx * cx + cy * cy);
  const x1 = (cx - sin * d).toFixed(2);
  const y1 = (cy - cos * d).toFixed(2);
  const x2 = (cx + sin * d).toFixed(2);
  const y2 = (cy + cos * d).toFixed(2);

  return (
    `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">` +
    stops +
    `</linearGradient>`
  );
}

// ─── Rectangle SVG builder ───────────────────────────────────────────────────

/**
 * Build the SVG string for a rectangle layer overlay.
 * Supports solid colour, linear/radial gradient fill, border_radius, and border.
 */
export function buildRectangleLayerSvg(layer: RectangleLayer): string {
  const { width: w, height: h } = layer;
  const rx = layer.border_radius > 0 ? ` rx="${layer.border_radius}" ry="${layer.border_radius}"` : "";

  let defs = "";
  let fill: string;

  if (layer.gradient) {
    const gradId = "g0";
    defs = `<defs>${buildGradientDef(layer.gradient, w, h, gradId)}</defs>`;
    fill = `url(#${gradId})`;
  } else {
    fill = escapeXml(layer.color ?? "transparent");
  }

  let strokeAttrs = "";
  if (layer.border) {
    const { color, width: sw, style } = layer.border;
    strokeAttrs = ` stroke="${escapeXml(color)}" stroke-width="${sw}"`;
    if (style === "dashed") strokeAttrs += ` stroke-dasharray="${sw * 4} ${sw * 2}"`;
    if (style === "dotted") strokeAttrs += ` stroke-dasharray="${sw} ${sw * 2}" stroke-linecap="round"`;
  }

  const rect =
    `<rect x="0" y="0" width="${w}" height="${h}"${rx} fill="${fill}"${strokeAttrs}/>`;

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${defs}${rect}</svg>`;
}

// ─── Public render function ───────────────────────────────────────────────────

/**
 * Render a RectangleLayer into a sharp.OverlayOptions for compositing.
 * E5 adds rotation + skew. E8 wires into compositeImage() dispatch.
 */
export async function renderRectangleLayer(
  layer: RectangleLayer,
): Promise<sharp.OverlayOptions> {
  const svg = buildRectangleLayerSvg(layer);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    input: png,
    left: Math.round(layer.x),
    top: Math.round(layer.y),
  };
}
