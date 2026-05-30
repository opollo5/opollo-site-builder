/**
 * Golden-image suite — E7 CI gate (§11, §1.1).
 *
 * Renders each fixture template via the sharp renderer and compares the
 * output to a committed reference PNG. Any pixel difference beyond the
 * tolerance fails the test.
 *
 * FIRST RUN / SNAPSHOT UPDATE:
 *   UPDATE_GOLDEN=1 npm run test:golden
 *   This writes new snapshots to tests/golden/snapshots/<fixture-id>.png.
 *   Commit the generated PNGs, then request Steven's §7 visual review.
 *
 * NORMAL CI RUN:
 *   npm run test:golden
 *   Compares current renderer output against committed snapshots.
 *   Fails if any pixel channel value differs by > PIXEL_TOLERANCE.
 *
 * Tolerance: PIXEL_TOLERANCE=4 (per-channel, 0–255 scale).
 *   The 2-pixel spatial tolerance in §7 applies to the DOM vs sharp comparison
 *   (E7 baseline). Run-to-run sharp output should be pixel-perfect (tolerance=0),
 *   but we allow a small margin for any system-level rendering variance.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// Golden tests run real sharp — do NOT mock it.
// The fixtures import from layer-renderer which imports "server-only".
// In Node.js (vitest) environment, server-only is a no-op; no stub needed.

import { renderTemplate } from "@/lib/image/compositing/layer-renderer";
import { ALL_FIXTURES } from "./fixtures";

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
