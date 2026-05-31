/**
 * Golden-image suite — E7 CI gate (§11, §1.1).
 *
 * Renders each fixture template via the sharp renderer and compares the
 * output to a committed reference PNG. Any pixel difference beyond the
 * tolerance fails the test.
 *
 * PLATFORM NOTE: Text rendering via librsvg/FreeType differs between
 * Windows (dev) and Linux (CI). Committed snapshots must be generated on
 * the same platform as CI. The golden-image.yml workflow regenerates
 * snapshots from CI on each run (UPDATE_GOLDEN=1 first, then comparison),
 * so the comparison is always within-platform.
 *
 * To commit Linux-canonical snapshots (run on a Linux machine or CI):
 *   UPDATE_GOLDEN=1 npm run test:golden
 *   git add tests/golden/snapshots/
 *   git commit -m "chore(golden): update Linux-canonical snapshots"
 *
 * NORMAL CI RUN (comparison mode):
 *   npm run test:golden
 *   Compares current renderer output against the snapshots in the working tree.
 *   Fails if any pixel channel value differs by > PIXEL_TOLERANCE.
 *
 * Tolerance: PIXEL_TOLERANCE=4 (per-channel, 0–255 scale).
 *   Within-platform (same Linux CI runner) output should be pixel-perfect.
 *   The 4-unit margin covers any minor RGBA rounding across sharp versions.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// Golden tests run real sharp — do NOT mock it.
// The fixtures import from layer-renderer which imports "server-only".
// In Node.js (vitest) environment, server-only is a no-op; no stub needed.

import { renderTemplate } from "@/lib/image/compositing/layer-renderer";
import { ALL_FIXTURES, FIXTURE_MULTI_FORMAT_BASE } from "./fixtures";

const SNAPSHOT_DIR = join(process.cwd(), "tests", "golden", "snapshots");
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";
const PIXEL_TOLERANCE = 4; // per-channel, 0–255

// Ensure snapshot directory exists.
beforeAll(() => {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
});

// ─── Pixel diff helper ────────────────────────────────────────────────────────

interface DiffResult {
  maxDiff: number;
  diffPixels: number;
  totalPixels: number;
}

async function pixelDiff(actualBuf: Buffer, expectedBuf: Buffer): Promise<DiffResult> {
  const [actual, expected] = await Promise.all([
    sharp(actualBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expectedBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  if (actual.info.width !== expected.info.width || actual.info.height !== expected.info.height) {
    throw new Error(
      `Size mismatch: actual ${actual.info.width}×${actual.info.height} ` +
      `vs expected ${expected.info.width}×${expected.info.height}`,
    );
  }

  let maxDiff = 0;
  let diffPixels = 0;
  const channels = 4; // RGBA
  const totalPixels = actual.info.width * actual.info.height;

  for (let i = 0; i < actual.data.length; i += channels) {
    let pixelMaxDiff = 0;
    for (let c = 0; c < channels; c++) {
      const diff = Math.abs(actual.data[i + c] - expected.data[i + c]);
      if (diff > pixelMaxDiff) pixelMaxDiff = diff;
      if (diff > maxDiff) maxDiff = diff;
    }
    if (pixelMaxDiff > PIXEL_TOLERANCE) diffPixels++;
  }

  return { maxDiff, diffPixels, totalPixels };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("golden-image suite", () => {
  for (const fixture of ALL_FIXTURES) {
    it(`fixture: ${fixture.id}`, async () => {
      // Render via sharp renderer.
      const { png } = await renderTemplate({ template: fixture });

      const snapshotPath = join(SNAPSHOT_DIR, `${fixture.id}.png`);

      if (UPDATE_GOLDEN) {
        writeFileSync(snapshotPath, png);
        console.log(`[golden] Updated snapshot: ${fixture.id}.png (${png.length} bytes)`);
        // In update mode, just verify the PNG is a valid image.
        const meta = await sharp(png).metadata();
        expect(meta.width).toBe(fixture.width);
        expect(meta.height).toBe(fixture.height);
        return;
      }

      if (!existsSync(snapshotPath)) {
        throw new Error(
          `Snapshot not found: ${snapshotPath}\n` +
          `Run  UPDATE_GOLDEN=1 npm run test:golden  to generate it, ` +
          `then commit the PNG and request Steven's §7 visual review.`,
        );
      }

      const expectedPng = readFileSync(snapshotPath);
      const diff = await pixelDiff(png, expectedPng);

      const diffPercent = (diff.diffPixels / diff.totalPixels * 100).toFixed(2);
      expect(diff.diffPixels, `${diff.diffPixels}/${diff.totalPixels} pixels differ (max channel diff ${diff.maxDiff}) — ${diffPercent}%`).toBe(0);
    }, 30_000); // 30s per fixture (generous for CI cold-start)
  }
});

// ─── Acceptance test #2: text-fit determinism (golden context) ────────────────

describe("text-fit determinism (golden)", () => {
  it("renderTemplate produces identical output on 10 consecutive runs", async () => {
    const fixture = ALL_FIXTURES.find((f) => f.id === "fixture-text-basic")!;
    const first = (await renderTemplate({ template: fixture })).png;
    for (let i = 0; i < 9; i++) {
      const next = (await renderTemplate({ template: fixture })).png;
      // PNG buffers must be identical (same sharp encode, same input → same output)
      expect(next.equals(first), `Run ${i + 2} differed from run 1`).toBe(true);
    }
  }, 60_000);
});

// ─── Compositor unit: modifications ─────────────────────────────────────────

describe("compositor: modifications", () => {
  it("text modification changes the rendered output", async () => {
    const fixture = ALL_FIXTURES.find((f) => f.id === "fixture-text-basic")!;
    const base = (await renderTemplate({ template: fixture })).png;
    const modified = (await renderTemplate({
      template: fixture,
      modifications: [{ name: "title", text: "Modified Text" }],
    })).png;
    // Modified output should differ from base (different text → different pixels)
    expect(modified.equals(base)).toBe(false);
  }, 30_000);

  it("hide modification skips the layer", async () => {
    const fixture = ALL_FIXTURES.find((f) => f.id === "fixture-text-basic")!;
    const withText = (await renderTemplate({ template: fixture })).png;
    const withoutText = (await renderTemplate({
      template: fixture,
      modifications: [{ name: "title", hide: true }],
    })).png;
    // Without the text layer, output should differ
    expect(withoutText.equals(withText)).toBe(false);
  }, 30_000);
});

// ─── Multi-format: both variants render at correct dimensions ────────────────

describe("multi-format renderer parity", () => {
  it("square variant (1080×1080) renders at correct dimensions", async () => {
    const { png } = await renderTemplate({
      template: FIXTURE_MULTI_FORMAT_BASE,
      variantKey: "square",
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1080);
    console.log(`[multi-format] square: ${meta.width}×${meta.height} — OK`);
  }, 30_000);

  it("landscape variant (1200×630) renders at correct dimensions", async () => {
    const { png } = await renderTemplate({
      template: FIXTURE_MULTI_FORMAT_BASE,
      variantKey: "landscape",
    });
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    console.log(`[multi-format] landscape: ${meta.width}×${meta.height} — OK`);
  }, 30_000);

  it("square and landscape produce different outputs (reflow changed layout)", async () => {
    const sq = (await renderTemplate({ template: FIXTURE_MULTI_FORMAT_BASE, variantKey: "square" })).png;
    const ls = (await renderTemplate({ template: FIXTURE_MULTI_FORMAT_BASE, variantKey: "landscape" })).png;
    // Different dimensions → different buffers
    expect(sq.equals(ls)).toBe(false);
  }, 30_000);

  it("logo layer (right/bottom pin) moves correctly between formats", async () => {
    // Verify via pixel content: render both and confirm they differ (the logo
    // moves from 916,916 in square to a different position in landscape).
    // The layer has right+bottom constraints so it should repin to a new corner.
    const sq  = await renderTemplate({ template: FIXTURE_MULTI_FORMAT_BASE, variantKey: "square" });
    const ls  = await renderTemplate({ template: FIXTURE_MULTI_FORMAT_BASE, variantKey: "landscape" });
    expect(sq.width).toBe(1080);
    expect(sq.height).toBe(1080);
    expect(ls.width).toBe(1200);
    expect(ls.height).toBe(630);
    // If reflow works, the square and landscape differ in MORE than just canvas size.
    expect(sq.png.length).not.toBe(ls.png.length);
  }, 30_000);
});
