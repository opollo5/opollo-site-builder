#!/usr/bin/env tsx
/**
 * scripts/probes/a-new-1-composite-verify.ts
 *
 * A-NEW-1 visual checkpoint: renders one composited image per §1.1 aspect
 * ratio using the sharp-based compositor and the verified A1 backgrounds
 * stored in the generated-images bucket (uploaded by a1-ideogram-v3-verify.ts).
 *
 * Inlines the compositing logic to avoid server-only import constraints in
 * the probe script context. The production path goes through
 * lib/image/compositing/sharp-renderer.ts (which has server-only).
 *
 * Surfaces 5 signed URLs (2-hour TTL) for Steven's visual review.
 * CI green + Steven's approval = A-NEW-1 merge gate.
 *
 * Usage:
 *   npx tsx --env-file=.env.production.local scripts/probes/a-new-1-composite-verify.ts
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 7200; // 2 hours
const PROBE_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

const HEADLINE = "Grow your LinkedIn presence with expert IT insights";

// TEXT_ZONE_MAP (from lib/image/compositing/text-zones.ts — inlined to avoid server-only)
const TEXT_ZONE_MAP: Record<string, { x: number; y: number; width: number; height: number; alignment: "left" | "center" | "right" }> = {
  split_layout:    { x: 58, y: 15, width: 37, height: 70, alignment: "left" },
  gradient_fade:   { x:  5, y: 15, width: 37, height: 70, alignment: "left" },
  full_background: { x:  5, y: 68, width: 90, height: 24, alignment: "center" },
};

// TEMPLATES_V1 (from lib/image/compositing/templates-v1.ts — inlined)
const TEMPLATES: Record<string, { compositionType: string; overlayAlpha: number; maxHeadlineFontSize: number }> = {
  "1x1":  { compositionType: "split_layout",    overlayAlpha: 0.75, maxHeadlineFontSize: 56 },
  "4x5":  { compositionType: "split_layout",    overlayAlpha: 0.75, maxHeadlineFontSize: 52 },
  "9x16": { compositionType: "full_background", overlayAlpha: 0.82, maxHeadlineFontSize: 48 },
  "16x9": { compositionType: "gradient_fade",   overlayAlpha: 0.78, maxHeadlineFontSize: 52 },
  "4x3":  { compositionType: "split_layout",    overlayAlpha: 0.75, maxHeadlineFontSize: 48 },
};

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const charWidth = fontSize * 0.55;
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
      current = word.length > maxChars ? word : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function autoFit(text: string, textW: number, textH: number, max: number): number {
  let lo = 12, hi = Math.min(max, 120), best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const totalH = wrapText(text, mid, textW).length * Math.round(mid * 1.3);
    if (totalH <= textH) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

function escX(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function compositeInline(
  bgBuf: Buffer, ratio: string, headline: string
): Promise<Buffer> {
  const meta = await sharp(bgBuf).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;

  const tpl = TEMPLATES[ratio]!;
  const zone = TEXT_ZONE_MAP[tpl.compositionType]!;

  const zx = Math.round((zone.x / 100) * W);
  const zy = Math.round((zone.y / 100) * H);
  const zw = Math.round((zone.width / 100) * W);
  const zh = Math.round((zone.height / 100) * H);

  const padX = Math.round(zw * 0.08);
  const padY = Math.round(zh * 0.06);
  const textW = zw - padX * 2;
  const textH = zh - padY * 2;

  const fontSize = autoFit(headline, textW, textH, tpl.maxHeadlineFontSize);
  const lines = wrapText(headline, fontSize, textW);
  const lineH = Math.round(fontSize * 1.3);
  const totalTextH = lines.length * lineH;
  const startY = Math.round(padY + Math.max(0, (textH - totalTextH) / 2) + fontSize);

  const anchor = zone.alignment === "center" ? "middle" : "start";
  const tx = zone.alignment === "center" ? Math.round(zw / 2) : padX;

  const svgLines = lines.map((l, i) =>
    `<text x="${tx}" y="${startY + i * lineH}" text-anchor="${anchor}" font-family="sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${escX(l)}</text>`
  ).join("\n");

  const svg = `<svg width="${zw}" height="${zh}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${zw}" height="${zh}" fill="rgba(0,0,0,${tpl.overlayAlpha})"/>
  ${svgLines}
</svg>`;

  return sharp(bgBuf)
    .resize(W, H, { fit: "cover" })
    .composite([{ input: Buffer.from(svg), left: Math.max(0, zx), top: Math.max(0, zy) }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function run() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required."); process.exit(1); }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("\nListing A1 probe backgrounds from storage...");
  const { data: files } = await supabase.storage.from(BUCKET).list(`${PROBE_COMPANY_ID}/generated`);
  const probeFiles = (files ?? []).filter(f => f.name.includes("probe-a1"));

  if (!probeFiles.length) {
    console.error("ERROR: No probe-a1 files found. Run scripts/probes/a1-ideogram-v3-verify.ts first.");
    process.exit(1);
  }

  const bgMap = new Map<string, string>();
  for (const f of probeFiles) {
    const m = f.name.match(/probe-a1-(\d+)_(\d+)/);
    if (m) bgMap.set(`${m[1]}x${m[2]}`, `${PROBE_COMPANY_ID}/generated/${f.name}`);
  }

  console.log(`Found backgrounds for ratios: ${[...bgMap.keys()].join(", ")}\nCompositing...\n`);

  const results: Array<{ ratio: string; url: string | null; error: string | null }> = [];
  const RATIOS = ["1x1", "4x5", "9x16", "16x9", "4x3"];

  for (const ratio of RATIOS) {
    const bgPath = bgMap.get(ratio);
    if (!bgPath) { results.push({ ratio, url: null, error: "No background for this ratio" }); continue; }

    try {
      const { data: blob } = await supabase.storage.from(BUCKET).download(bgPath);
      if (!blob) throw new Error("Download returned no data");
      const bgBuf = Buffer.from(await blob.arrayBuffer());

      const compositeBuf = await compositeInline(bgBuf, ratio, HEADLINE);

      const compositePath = bgPath.replace("/generated/", "/composite/").replace(".png", "-anew1.jpg");
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(compositePath, compositeBuf, {
        contentType: "image/jpeg", upsert: true,
      });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(compositePath, SIGNED_URL_TTL);
      results.push({ ratio, url: signed?.signedUrl ?? null, error: null });
      console.log(`  ✓ ${ratio}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ ratio, url: null, error });
      console.error(`  ✗ ${ratio}: ${error}`);
    }
  }

  const succeeded = results.filter(r => r.url).length;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`A-NEW-1 COMPOSITE VERIFICATION — ${succeeded}/${RATIOS.length} succeeded`);
  console.log(`Headline: "${HEADLINE}"`);
  console.log("=".repeat(72));

  for (const r of results) {
    if (r.error) { console.log(`\n[FAILED] ${r.ratio}\n  Error: ${r.error}`); }
    else         { console.log(`\n[OK] ${r.ratio}\n  ${r.url}`); }
  }

  if (succeeded < RATIOS.length) { process.exit(1); }
  console.log("\nAll 5 composites ready for Steven's visual review.");
}

run().catch(err => { console.error("Probe crashed:", err); process.exit(1); });
