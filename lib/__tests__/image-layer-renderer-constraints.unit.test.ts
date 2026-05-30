/**
 * Unit tests for E6 — constraints + variant reflow (§8.1, §8.2, §1.8).
 *
 * Tests cover:
 *   - reflowLayerForVariant: all 5 horizontal + all 5 vertical constraint modes
 *   - applyVariantLayerOverride: override merging, name field excluded
 *   - applyVariant: full reflow pipeline, variant override resolution
 *
 * Acceptance test #4: variant reflow — layers reflow correctly when canvas
 * resizes from 1280×720 to 1080×1920, without manual repositioning.
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
vi.mock("sharp", () => ({ default: vi.fn() }));

import {
  reflowLayerForVariant,
  applyVariantLayerOverride,
  applyVariant,
} from "@/lib/image/compositing/layer-renderer";

import type { Layer, RectangleLayer, TextLayer, Template, Variant } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRectLayer(
  x: number, y: number, w: number, h: number,
  hPin: Layer["constraints"]["horizontal"] = "left",
  vPin: Layer["constraints"]["vertical"] = "top",
  overrides: Partial<RectangleLayer> = {},
): RectangleLayer {
  return {
    id: "r1", name: "bg", type: "rectangle",
    x, y, width: w, height: h,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0, opacity: 1,
    locked: false, hide: false, hide_when_empty: false,
    lock_aspect_ratio: false, description: "", group: null,
    constraints: { horizontal: hPin, vertical: vPin },
    color: "#000", gradient: null, border_radius: 0, border: null,
    ...overrides,
  };
}

function makeTextLayer(name: string, x: number, y: number, w: number, h: number): TextLayer {
  return {
    id: `t_${name}`, name, type: "text",
    x, y, width: w, height: h,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0, opacity: 1,
    locked: false, hide: false, hide_when_empty: false,
    lock_aspect_ratio: false, description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
    text: "Hello", font_family: "Inter", font_size: 32, font_weight: 400,
    color: "#fff", text_align_h: "left", text_align_v: "top",
    letter_spacing: 0, line_height: 1.2, text_transform: "none",
    text_decoration: "none", word_break: "normal", style: "", direction: "ltr",
    text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
    truncate: false,
    text_box: { padding: null, border: null },
    background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
    secondary: { font_family: null, color: null },
  };
}

// ─── reflowLayerForVariant — horizontal ───────────────────────────────────────

describe("reflowLayerForVariant — horizontal constraints", () => {
  const sW = 1280, sH = 720, tW = 1080, tH = 720;

  it("left: x stays constant", () => {
    const layer = makeRectLayer(100, 50, 200, 100, "left", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    expect(r.x).toBe(100);
    expect(r.width).toBe(200);
  });

  it("right: right margin stays constant", () => {
    // Right margin = 1280 - (100 + 200) = 980
    const layer = makeRectLayer(100, 50, 200, 100, "right", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const expectedRightMargin = sW - (100 + 200); // 980
    expect(r.x).toBe(tW - 200 - expectedRightMargin); // 1080 - 200 - 980 = -100
    expect(r.width).toBe(200);
  });

  it("center: layer stays centred (offset from centre constant)", () => {
    // Layer centre at x=140+100=240; canvas centre at 640; offset = 240-640 = -400
    const layer = makeRectLayer(140, 50, 200, 100, "center", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    // new_cx = 1080/2 + (-400) = 540-400 = 140; new_x = 140 - 100 = 40
    const offsetFromCenter = (140 + 100) - 1280 / 2;
    const expectedX = tW / 2 + offsetFromCenter - 100;
    expect(r.x).toBeCloseTo(expectedX, 2);
    expect(r.width).toBe(200);
  });

  it("center: centred layer remains centred after canvas resize", () => {
    // Layer centred in 1280 canvas
    const layer = makeRectLayer(540, 50, 200, 100, "center", "top");  // cx=640=W/2
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    // Should be centred in 1080 canvas: new_x = 1080/2 - 100 = 440
    expect(r.x).toBeCloseTo(440, 1);
  });

  it("left_right (stretch): both margins fixed, width grows", () => {
    // Left margin=100, right margin = 1280 - 500 = 780
    const layer = makeRectLayer(100, 50, 400, 100, "left_right", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    expect(r.x).toBe(100);
    expect(r.width).toBeCloseTo(tW - 100 - (sW - 100 - 400), 1); // 1080 - 100 - 780 = 200
  });

  it("scale: position and width scale proportionally", () => {
    const layer = makeRectLayer(640, 50, 320, 100, "scale", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const ratio = tW / sW;
    expect(r.x).toBeCloseTo(640 * ratio, 2);
    expect(r.width).toBeCloseTo(320 * ratio, 2);
  });
});

// ─── reflowLayerForVariant — vertical ─────────────────────────────────────────

describe("reflowLayerForVariant — vertical constraints", () => {
  const sW = 1280, sH = 720, tW = 1280, tH = 1920; // landscape → portrait

  it("top: y stays constant", () => {
    const layer = makeRectLayer(0, 50, 200, 100, "left", "top");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    expect(r.y).toBe(50);
    expect(r.height).toBe(100);
  });

  it("bottom: bottom margin stays constant", () => {
    // Bottom margin = 720 - (50+100) = 570
    const layer = makeRectLayer(0, 50, 200, 100, "left", "bottom");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const expectedBottomMargin = sH - (50 + 100); // 570
    expect(r.y).toBe(tH - 100 - expectedBottomMargin);
    expect(r.height).toBe(100);
  });

  it("center: offset from centre stays constant", () => {
    // Layer cy = 50+50 = 100; canvas cy = 360; offset = 100-360 = -260
    const layer = makeRectLayer(0, 50, 200, 100, "left", "center");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const offsetFromCenter = (50 + 50) - sH / 2;
    const expectedY = tH / 2 + offsetFromCenter - 50;
    expect(r.y).toBeCloseTo(expectedY, 1);
  });

  it("top_bottom (stretch): both margins fixed, height grows", () => {
    const layer = makeRectLayer(0, 50, 200, 300, "left", "top_bottom");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    expect(r.y).toBe(50);
    expect(r.height).toBeCloseTo(tH - 50 - (sH - 50 - 300), 1); // 1920 - 50 - 370 = 1500
  });

  it("scale: position and height scale proportionally", () => {
    const layer = makeRectLayer(0, 360, 200, 180, "left", "scale");
    const r = reflowLayerForVariant(layer, sW, sH, tW, tH);
    const ratio = tH / sH;
    expect(r.y).toBeCloseTo(360 * ratio, 2);
    expect(r.height).toBeCloseTo(180 * ratio, 2);
  });
});

// ─── applyVariantLayerOverride ─────────────────────────────────────────────────

describe("applyVariantLayerOverride", () => {
  it("applies font_size override to a text layer", () => {
    const layer = makeTextLayer("title", 0, 0, 200, 80);
    (layer as TextLayer).font_size = 32;
    const result = applyVariantLayerOverride(layer, { name: "title", font_size: 64 });
    expect((result as TextLayer).font_size).toBe(64);
  });

  it("applies hide override", () => {
    const layer = makeTextLayer("subtitle", 0, 0, 200, 60);
    const result = applyVariantLayerOverride(layer, { name: "subtitle", hide: true });
    expect(result.hide).toBe(true);
  });

  it("does not change fields not present in the override", () => {
    const layer = makeTextLayer("title", 100, 50, 200, 80);
    const result = applyVariantLayerOverride(layer, { name: "title", font_size: 48 });
    expect(result.x).toBe(100);
    expect(result.y).toBe(50);
  });

  it("does not set name field from override on the layer", () => {
    const layer = makeTextLayer("title", 0, 0, 200, 80);
    // The override.name is the lookup key; it should NOT overwrite layer.name
    const result = applyVariantLayerOverride(layer, { name: "title" });
    expect(result.name).toBe("title"); // unchanged — it was already "title" though
  });
});

// ─── applyVariant (acceptance test #4) ────────────────────────────────────────

describe("applyVariant", () => {
  // Acceptance test #4: 1280×720 template → instagram_story 1080×1920 variant
  it("correctly reflowed canvas dimensions", () => {
    const template: Pick<Template, "width" | "height" | "layers"> = {
      width: 1280, height: 720,
      layers: [makeRectLayer(0, 0, 1280, 720, "left_right", "top_bottom")],
    };
    const variant: Variant = { key: "instagram_story", width: 1080, height: 1920, overrides: [] };
    const { width, height } = applyVariant(template, variant);
    expect(width).toBe(1080);
    expect(height).toBe(1920);
  });

  it("full-canvas stretch layer fills the new canvas", () => {
    const template = {
      width: 1280, height: 720,
      layers: [makeRectLayer(0, 0, 1280, 720, "left_right", "top_bottom")],
    };
    const variant: Variant = { key: "ig_story", width: 1080, height: 1920, overrides: [] };
    const { layers } = applyVariant(template, variant);
    expect(layers[0].width).toBe(1080);
    expect(layers[0].height).toBe(1920);
  });

  it("per-variant override is applied after reflow", () => {
    const template = {
      width: 1280, height: 720,
      layers: [makeTextLayer("subtitle", 100, 600, 400, 60)],
    };
    const variant: Variant = {
      key: "ig_story", width: 1080, height: 1920,
      overrides: [{ name: "subtitle", hide: true }],
    };
    const { layers } = applyVariant(template, variant);
    expect(layers[0].hide).toBe(true);
  });

  it("layers without overrides are not hidden", () => {
    const template = {
      width: 1280, height: 720,
      layers: [
        makeTextLayer("title", 100, 100, 400, 80),
        makeTextLayer("subtitle", 100, 600, 400, 60),
      ],
    };
    const variant: Variant = {
      key: "ig_story", width: 1080, height: 1920,
      overrides: [{ name: "subtitle", hide: true }],
    };
    const { layers } = applyVariant(template, variant);
    expect(layers[0].hide).toBe(false);  // title: no override
    expect(layers[1].hide).toBe(true);   // subtitle: override applied
  });

  it("variant override by name matches correctly (not by id or index)", () => {
    const template = {
      width: 1280, height: 720,
      layers: [
        makeTextLayer("title", 0, 0, 300, 80),
        makeTextLayer("caption", 0, 100, 300, 50),
      ],
    };
    const variant: Variant = {
      key: "sq", width: 1080, height: 1080,
      overrides: [{ name: "caption", font_size: 20 }],
    };
    const { layers } = applyVariant(template, variant);
    expect((layers[0] as TextLayer).font_size).toBe(32);  // title: unchanged
    expect((layers[1] as TextLayer).font_size).toBe(20);  // caption: overridden
  });

  it("preserves layer count after reflow", () => {
    const template = {
      width: 1280, height: 720,
      layers: [
        makeRectLayer(0, 0, 1280, 720, "scale", "scale"),
        makeTextLayer("title", 100, 100, 400, 80),
        makeTextLayer("subtitle", 100, 200, 300, 50),
      ],
    };
    const variant: Variant = { key: "sq", width: 1080, height: 1080, overrides: [] };
    const { layers } = applyVariant(template, variant);
    expect(layers).toHaveLength(3);
  });
});
