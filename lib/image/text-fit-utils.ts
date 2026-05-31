/**
 * text-fit-utils — client-safe text measurement and fit utilities.
 *
 * These functions are extracted from lib/image/compositing/layer-renderer.ts
 * (which has `import "server-only"`) so they can also be used in the
 * client-side DOM renderer (CanvasContent.tsx) to make the editor preview
 * match the server-side sharp render output.
 *
 * Design spec §7, §1.6.
 */

import type { TextFitOptions } from "./template-model";

// ─── Character advance-width table ────────────────────────────────────────────

/**
 * Per-character advance-width ratios (advance_width / font_size) for Inter Regular.
 * Derived from Inter 4.0 UPM=2048 advance widths, normalised.
 */
export const CHAR_RATIO: Record<string, number> = {
  " ": 0.250, ",": 0.278, ".": 0.278, ":": 0.278, ";": 0.278,
  "!": 0.278, "?": 0.444, "'": 0.222, '"': 0.361, "`": 0.278,
  "-": 0.333, "–": 0.556, "—": 1.000, "(": 0.333, ")": 0.333,
  "[": 0.333, "]": 0.333, "{": 0.333, "}": 0.333, "/": 0.389,
  "\\": 0.389, "|": 0.222, "@": 0.861, "#": 0.556, "$": 0.556,
  "%": 0.722, "&": 0.722, "*": 0.556, "+": 0.583, "=": 0.583,
  "<": 0.583, ">": 0.583,
  a: 0.556, b: 0.556, c: 0.500, d: 0.556, e: 0.556, f: 0.278,
  g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.500, l: 0.222,
  m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333,
  s: 0.500, t: 0.333, u: 0.556, v: 0.500, w: 0.722, x: 0.500,
  y: 0.500, z: 0.500,
  A: 0.667, B: 0.611, C: 0.667, D: 0.722, E: 0.611, F: 0.556,
  G: 0.722, H: 0.722, I: 0.278, J: 0.444, K: 0.667, L: 0.556,
  M: 0.833, N: 0.722, O: 0.778, P: 0.611, Q: 0.778, R: 0.667,
  S: 0.556, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667,
  Y: 0.611, Z: 0.611,
  "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556,
  "5": 0.556, "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556,
};

export const AVERAGE_CHAR_RATIO = 0.550;

// ─── Text measurement ─────────────────────────────────────────────────────────

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
    width += (CHAR_RATIO[ch] ?? AVERAGE_CHAR_RATIO) * fontSize * boldFactor;
  }
  width += letterSpacing * Math.max(0, text.length - 1);
  return width;
}

// ─── Word wrap ────────────────────────────────────────────────────────────────

export function wrapLayerText(
  text: string,
  boxWidth: number,
  fontSize: number,
  fontWeight: number,
  letterSpacing: number,
  wordBreak = "normal",
): string[] {
  const TOL = 2;
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

  if (wordBreak === "break-all" || wordBreak === "break-word") {
    return lines.flatMap((line) => {
      const lw = measureTextWidth(line, fontSize, fontWeight, letterSpacing);
      if (lw <= boxWidth + TOL) return [line];
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

// ─── Binary-search text fit (§7) ─────────────────────────────────────────────

/**
 * Find the largest integer font size in [min_size, max_size] such that the
 * wrapped text fits within box.width × box.height and within max_lines.
 * Max 20 iterations; 1-2px tolerance. Identical algorithm on client and server.
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
  const TOL = 2;

  let lo = opts.min_size;
  let hi = opts.max_size;
  let best = lo;

  for (let i = 0; i < MAX_ITERS; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = wrapLayerText(text, box.width, mid, fontWeight, letterSpacing, wordBreak);
    const totalH = lines.length * mid * lineHeight;
    const maxLineW = Math.max(...lines.map((l) => measureTextWidth(l, mid, fontWeight, letterSpacing)));

    if (maxLineW <= box.width + TOL && totalH <= box.height + TOL && lines.length <= opts.max_lines) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
    if (lo > hi) break;
  }

  return best;
}
