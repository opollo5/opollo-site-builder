import "server-only";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { CompositeInput, CompositeResult } from "./index";

// ---------------------------------------------------------------------------
// sharp-renderer — native compositing via sharp + librsvg.
//
// Replaces the Bannerbear third-party compositing path. No external API calls;
// all rendering happens in-process using the bundled vips/rsvg build.
//
// Fonts (OFL-1.1, all free for commercial use) from assets/fonts/:
//   Inter, Roboto, Montserrat, Open Sans, Poppins — regular + bold woff2.
// Falls back to system sans-serif when woff2 files are absent.
// See assets/fonts/README.md for sources and licence notices.
//
// Per §1.8 of MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md:
//   - All compositing goes through compositeImage() → this module.
//   - No consumer module may call sharp directly.
// ---------------------------------------------------------------------------

const BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const FONTS_DIR = join(process.cwd(), "assets", "fonts");

// Load woff2 font as base64, or return null if absent.
function loadFont(filename: string): string | null {
  const p = join(FONTS_DIR, filename);
  if (!existsSync(p)) return null;
  return readFileSync(p).toString("base64");
}

// All five font families (regular + bold) — pre-loaded once at module init.
// The template editor (A-NEW-3) exposes these as the font picker options.
interface FontPair { regular: string | null; bold: string | null }
const FONTS: Record<string, FontPair> = {
  Inter:       { regular: loadFont("Inter-Regular.woff2"),       bold: loadFont("Inter-Bold.woff2")       },
  Roboto:      { regular: loadFont("Roboto-Regular.woff2"),      bold: loadFont("Roboto-Bold.woff2")      },
  Montserrat:  { regular: loadFont("Montserrat-Regular.woff2"),  bold: loadFont("Montserrat-Bold.woff2")  },
  "Open Sans": { regular: loadFont("OpenSans-Regular.woff2"),    bold: loadFont("OpenSans-Bold.woff2")    },
  Poppins:     { regular: loadFont("Poppins-Regular.woff2"),     bold: loadFont("Poppins-Bold.woff2")     },
};

// Default: first family that has both weights loaded; fall back to sans-serif.
const DEFAULT_FONT_FAMILY = (
  Object.entries(FONTS).find(([, p]) => p.regular && p.bold)?.[0] ?? null
);

if (!DEFAULT_FONT_FAMILY) {
  logger.warn("image.compositor.fonts_missing", {
    path: FONTS_DIR,
    note: "No woff2 fonts found. See assets/fonts/README.md. Falling back to system sans-serif.",
  });
}

// Build SVG @font-face declarations for all available families.
// woff2 is supported by librsvg 2.50+ (this build: 2.61.2).
const FONT_FACE_SVG = (() => {
  const rules: string[] = [];
  for (const [family, pair] of Object.entries(FONTS)) {
    if (pair.regular) {
      rules.push(`@font-face { font-family: '${family}'; font-weight: 400; src: url('data:font/woff2;base64,${pair.regular}') format('woff2'); }`);
    }
    if (pair.bold) {
      rules.push(`@font-face { font-family: '${family}'; font-weight: 700; src: url('data:font/woff2;base64,${pair.bold}') format('woff2'); }`);
    }
  }
  return rules.length > 0
    ? `<defs><style>${rules.join("\n")}</style></defs>`
    : "";
})();

// Font stack for SVG text elements: bundled family (if available) + system fallback.
const FONT_FAMILY = DEFAULT_FONT_FAMILY
  ? `'${DEFAULT_FONT_FAMILY}', sans-serif`
  : "sans-serif";

// ---------------------------------------------------------------------------
// Public entry point — implements the compositeImage() contract.
// ---------------------------------------------------------------------------

export async function compositeSharp(input: CompositeInput): Promise<CompositeResult> {
  const startMs = Date.now();
  const svc = getServiceRoleClient();

  // 1. Download background from Supabase Storage.
  const { data: bgBlob, error: dlErr } = await svc.storage
    .from(BUCKET)
    .download(input.backgroundStoragePath);

  if (dlErr || !bgBlob) {
    throw new Error(`Compositor: failed to download background (${dlErr?.message ?? "no data"})`);
  }

  const bgBuf = Buffer.from(await bgBlob.arrayBuffer());

  // 2. Resize background to requested output dimensions.
  const pipeline = sharp(bgBuf).resize(input.outputWidth, input.outputHeight, {
    fit: "cover",
    position: "center",
  });

  // 3. Build overlay layers (text zones + logo).
  const layers: sharp.OverlayOptions[] = [];

  for (const zone of input.textZones) {
    if (!zone.text.trim()) continue;

    const zx = Math.round((zone.x / 100) * input.outputWidth);
    const zy = Math.round((zone.y / 100) * input.outputHeight);
    const zw = Math.round((zone.width / 100) * input.outputWidth);
    const zh = Math.round((zone.height / 100) * input.outputHeight);

    const { svgOverlay } = buildTextZoneSvg({
      width: zw,
      height: zh,
      text: zone.text,
      maxFontSize: zone.maxFontSize,
      colour: zone.colour,
      alignment: zone.alignment,
    });

    layers.push({
      input: Buffer.from(svgOverlay),
      left: Math.max(0, zx),
      top: Math.max(0, zy),
    });
  }

  // 4. Logo.
  if (input.logo) {
    const logoLayer = await buildLogoLayer(input.logo, input.outputWidth, input.outputHeight);
    if (logoLayer) layers.push(logoLayer);
  }

  // 5. Composite and encode.
  const outputBuf = await pipeline
    .composite(layers)
    .toFormat(input.outputFormat, { quality: 90 })
    .toBuffer();

  // 6. Derive composite storage path from background path.
  const compositePath = deriveCompositePath(input.backgroundStoragePath);

  const { error: upErr } = await svc.storage.from(BUCKET).upload(compositePath, outputBuf, {
    contentType: `image/${input.outputFormat}`,
    upsert: true,
  });

  if (upErr) {
    throw new Error(`Compositor: storage upload failed (${upErr.message})`);
  }

  logger.info("image.compositor.completed", {
    backgroundPath: input.backgroundStoragePath,
    compositePath,
    durationMs: Date.now() - startMs,
    width: input.outputWidth,
    height: input.outputHeight,
  });

  return {
    storagePath: compositePath,
    provider: "sharp_native",
    durationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TextZoneSvgInput {
  width: number;
  height: number;
  text: string;
  maxFontSize: number;
  colour: "white" | "dark" | "overlay";
  alignment: "left" | "center" | "right";
}

function buildTextZoneSvg(input: TextZoneSvgInput): { svgOverlay: string } {
  const { width, height, text, maxFontSize, colour, alignment } = input;

  const textFill = colour === "dark" ? "#0f172a" : "#ffffff";
  const overlayFill = colour === "dark" ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.75)";

  // Padding inside the zone: 8% of width.
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.06);
  const textW = width - padX * 2;
  const textH = height - padY * 2;

  // Auto-fit: find largest font size where wrapped text fits in zone.
  const fontSize = autoFitFontSize(text, textW, textH, maxFontSize);
  const lines = wrapText(text, fontSize, textW);

  const lineH = Math.round(fontSize * 1.3);
  const totalTextH = lines.length * lineH;
  const startY = Math.round(padY + Math.max(0, (textH - totalTextH) / 2) + fontSize);

  const textAnchor = alignment === "center" ? "middle" : alignment === "right" ? "end" : "start";
  const textX = alignment === "center" ? Math.round(width / 2)
    : alignment === "right" ? width - padX
    : padX;

  const svgLines = lines.map((line, i) =>
    `<text x="${textX}" y="${startY + i * lineH}"
      text-anchor="${textAnchor}"
      font-family="${FONT_FAMILY}"
      font-weight="700"
      font-size="${fontSize}"
      fill="${textFill}">${escapeXml(line)}</text>`,
  ).join("\n");

  const svgOverlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  ${FONT_FACE_SVG}
  <rect x="0" y="0" width="${width}" height="${height}" fill="${overlayFill}" rx="0"/>
  ${svgLines}
</svg>`;

  return { svgOverlay };
}

async function buildLogoLayer(
  logo: NonNullable<CompositeInput["logo"]>,
  canvasW: number,
  canvasH: number,
): Promise<sharp.OverlayOptions | null> {
  try {
    const resp = await fetch(logo.url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      logger.warn("image.compositor.logo_fetch_failed", { status: resp.status });
      return null;
    }
    const logoBuf = Buffer.from(await resp.arrayBuffer());

    // Fit logo into a square of sizePercent × shorter dimension.
    const shortSide = Math.min(canvasW, canvasH);
    const targetSize = Math.round((logo.sizePercent / 100) * shortSide);
    const pad = logo.padding;

    const resized = await sharp(logoBuf)
      .resize(targetSize, targetSize, { fit: "inside", withoutEnlargement: true })
      .toBuffer();

    const meta = await sharp(resized).metadata();
    const lw = meta.width ?? targetSize;
    const lh = meta.height ?? targetSize;

    let left: number, top: number;
    switch (logo.position) {
      case "top-right":
        left = canvasW - lw - pad;
        top = pad;
        break;
      case "bottom-left":
        left = pad;
        top = canvasH - lh - pad;
        break;
      case "watermark-center":
        left = Math.round((canvasW - lw) / 2);
        top = Math.round((canvasH - lh) / 2);
        break;
      case "bottom-right":
      default:
        left = canvasW - lw - pad;
        top = canvasH - lh - pad;
    }

    return { input: resized, left: Math.max(0, left), top: Math.max(0, top) };
  } catch (err) {
    logger.warn("image.compositor.logo_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Find the largest integer font size ≤ maxFontSize such that the wrapped
 * text fits within textW × textH pixels.
 *
 * Approximation: character width ≈ 0.55 × fontSize, line height ≈ 1.3 × fontSize.
 * This is conservative and errs on the side of smaller text — exact rendering
 * is handled by rsvg which may produce slightly different metrics.
 */
export function autoFitFontSize(
  text: string,
  textW: number,
  textH: number,
  maxFontSize: number,
): number {
  let lo = 12;
  let hi = Math.min(maxFontSize, 120);
  let best = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const lines = wrapText(text, mid, textW);
    const totalH = lines.length * Math.round(mid * 1.3);

    if (totalH <= textH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

/**
 * Word-wrap text to fit within the given width, given an approximate font size.
 * Returns an array of line strings.
 */
export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const charWidth = fontSize * 0.55; // conservative approximation
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));

  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      // If a single word is longer than maxChars, hard-break it.
      if (word.length > maxChars) {
        let remaining = word;
        while (remaining.length > maxChars) {
          lines.push(remaining.slice(0, maxChars));
          remaining = remaining.slice(maxChars);
        }
        current = remaining;
      } else {
        current = word;
      }
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function deriveCompositePath(backgroundPath: string): string {
  // Background convention: {companyId}/generated/{ts}-{name}.{ext}
  // Composite convention:  {companyId}/composite/{ts}-{name}.{ext}
  return backgroundPath.replace("/generated/", "/composite/");
}
