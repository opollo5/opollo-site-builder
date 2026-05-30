/**
 * Unit tests for E5 transform functions.
 *
 * Tests cover:
 *  - computeRotatedBBox: bounding box geometry for all quadrants
 *  - applyLayerTransforms: pass-through when no transforms, opacity < 1,
 *    rotation shifts the composite position correctly
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

const { sharpChain, sharpFn } = vi.hoisted(() => {
  const chain = {
    png: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("FAKE_PNG")),
  };
  const fn = vi.fn().mockReturnValue(chain);
  return { sharpChain: chain, sharpFn: fn };
});
vi.mock("sharp", () => ({ default: sharpFn }));

import { computeRotatedBBox, applyLayerTransforms } from "@/lib/image/compositing/layer-renderer";
import type { Layer } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLayerBase(overrides: Partial<Layer> = {}): Pick<Layer, "rotation" | "rotate_x" | "rotate_y" | "rotate_z" | "skew_x" | "skew_y" | "opacity" | "width" | "height" | "name"> {
  return {
    rotation: 0,
    rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    opacity: 1,
    width: 100, height: 50,
    name: "test",
    ...overrides,
  };
}

function fakeOpts(left = 10, top = 20): { input: Buffer; left: number; top: number } {
  return { input: Buffer.from("FAKE"), left, top };
}

// ─── computeRotatedBBox ───────────────────────────────────────────────────────

describe("computeRotatedBBox", () => {
  it("0° rotation → same dimensions, no offset", () => {
    const { min_x, min_y, rotated_w, rotated_h } = computeRotatedBBox(100, 50, 0);
    expect(min_x).toBeCloseTo(0, 3);
    expect(min_y).toBeCloseTo(0, 3);
    expect(rotated_w).toBeCloseTo(100, 1);
    expect(rotated_h).toBeCloseTo(50, 1);
  });

  it("90° rotation of 100×50 → 50×100 bounding box", () => {
    const { rotated_w, rotated_h } = computeRotatedBBox(100, 50, 90);
    expect(rotated_w).toBeCloseTo(50, 1);
    expect(rotated_h).toBeCloseTo(100, 1);
  });

  it("180° rotation → same dimensions as original", () => {
    const { rotated_w, rotated_h } = computeRotatedBBox(100, 50, 180);
    expect(rotated_w).toBeCloseTo(100, 1);
    expect(rotated_h).toBeCloseTo(50, 1);
  });

  it("270° rotation of 100×50 → 50×100 bounding box", () => {
    const { rotated_w, rotated_h } = computeRotatedBBox(100, 50, 270);
    expect(rotated_w).toBeCloseTo(50, 1);
    expect(rotated_h).toBeCloseTo(100, 1);
  });

  it("45° rotation of 100×100 square → √2 × side", () => {
    const { rotated_w, rotated_h } = computeRotatedBBox(100, 100, 45);
    const expected = Math.round(100 * Math.SQRT2 * 10) / 10;
    expect(rotated_w).toBeCloseTo(expected, 0);
    expect(rotated_h).toBeCloseTo(expected, 0);
  });

  it("bounding box is always non-negative", () => {
    for (const angle of [0, 30, 45, 90, 135, 180, 270, 315, 360]) {
      const { rotated_w, rotated_h } = computeRotatedBBox(200, 100, angle);
      expect(rotated_w).toBeGreaterThanOrEqual(0);
      expect(rotated_h).toBeGreaterThanOrEqual(0);
    }
  });

  it("symmetrical: same result for +angle and -angle (modulo bbox swap)", () => {
    const pos = computeRotatedBBox(100, 50, 30);
    const neg = computeRotatedBBox(100, 50, -30);
    expect(pos.rotated_w).toBeCloseTo(neg.rotated_w, 1);
    expect(pos.rotated_h).toBeCloseTo(neg.rotated_h, 1);
  });
});

// ─── applyLayerTransforms ─────────────────────────────────────────────────────

describe("applyLayerTransforms", () => {
  it("pass-through when all transforms are identity (no-op)", async () => {
    const layer = makeLayerBase();
    const opts = fakeOpts(10, 20);
    const result = await applyLayerTransforms(layer, opts);
    // No sharp calls for the transform path; still returns valid opts
    expect(result.left).toBe(10);
    expect(result.top).toBe(20);
    expect(result.input).toBe(opts.input); // same buffer, not wrapped
  });

  it("opacity < 1 calls sharp composite (alpha mask)", async () => {
    sharpChain.toBuffer.mockResolvedValueOnce(Buffer.from("OPACITY_PNG"));
    const layer = makeLayerBase({ opacity: 0.5 });
    const result = await applyLayerTransforms(layer, fakeOpts(5, 10));
    expect(sharpFn).toHaveBeenCalled();
    expect(result.input).toBeInstanceOf(Buffer);
  });

  it("opacity = 1 does not call sharp (fast path)", async () => {
    sharpFn.mockClear();
    const layer = makeLayerBase({ opacity: 1 });
    await applyLayerTransforms(layer, fakeOpts());
    expect(sharpFn).not.toHaveBeenCalled();
  });

  it("rotation != 0 adjusts the composite position", async () => {
    // For a 90° rotation of 100×50, the bounding box becomes 50×100.
    // min_x for 90° ≈ -50, min_y ≈ 0  → position shifts by (-50, 0)
    sharpChain.toBuffer.mockResolvedValueOnce(Buffer.from("ROTATED_PNG"));
    const layer = makeLayerBase({ rotation: 90, width: 100, height: 50 });
    const opts = fakeOpts(100, 50);
    const result = await applyLayerTransforms(layer, opts);
    // left should shift by roughly -50 (min_x ≈ -50 for 90° rotation of 100×50)
    expect(result.left).toBeLessThan(100);
    expect(result.input).toBeInstanceOf(Buffer);
  });

  it("no-transform layers return same left/top", async () => {
    const layer = makeLayerBase({ rotation: 0, skew_x: 0, skew_y: 0, opacity: 1 });
    const opts = fakeOpts(42, 99);
    const result = await applyLayerTransforms(layer, opts);
    expect(result.left).toBe(42);
    expect(result.top).toBe(99);
  });
});
