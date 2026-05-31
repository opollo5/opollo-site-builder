/**
 * Golden test: template-mode modification application (Stream B Phase 1).
 *
 * Verifies that applyModifications() — the core of the template render path —
 * correctly applies Stream B spreadsheet-derived modifications to template layers.
 *
 * This is the regression gate for must-have #4: the modification pipeline must
 * produce deterministic output for any given template+modifications pair.
 *
 * Coverage:
 *  - Text layer: text override applies
 *  - Image layer: image_url override applies
 *  - Rectangle layer: color override applies
 *  - Unmatched modification (layer name not in template): ignored
 *  - Last-write-wins for duplicate modification keys
 *  - Empty modifications array: layers returned unchanged
 *  - Layer order preserved
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

import { applyModifications } from "@/lib/image/compositing/layer-renderer";
import type { Layer, TextLayer, ImageLayer, RectangleLayer } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseLayer(name: string): Pick<Layer, "id" | "name" | "x" | "y" | "width" | "height" | "opacity" | "locked" | "hide" | "rotation" | "rotate_x" | "rotate_y" | "rotate_z" | "skew_x" | "skew_y" | "lock_aspect_ratio" | "hide_when_empty" | "description" | "group" | "constraints"> {
  return {
    id: `id-${name}`,
    name,
    x: 0, y: 0, width: 400, height: 200,
    opacity: 1, rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    locked: false, hide: false, hide_when_empty: false, lock_aspect_ratio: false,
    description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
  };
}

function makeTextLayer(name: string, text: string): TextLayer {
  return {
    ...baseLayer(name),
    type: "text",
    text,
    font_family: "Inter", font_size: 32, font_weight: 400,
    color: "#ffffff", text_align_h: "left", text_align_v: "top",
    letter_spacing: 0, line_height: 1.2,
    text_transform: "none", text_decoration: "none",
    word_break: "normal", style: "", direction: "ltr",
    text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
    truncate: false,
    text_box: { padding: null, border: null },
    background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
    secondary: { font_family: null, color: null },
  };
}

function makeImageLayer(name: string, imageUrl: string): ImageLayer {
  return {
    ...baseLayer(name),
    type: "image",
    asset_id: null,
    image_url: imageUrl,
    fill: "cover",
    anchor_x: "center",
    anchor_y: "center",
    tint_color: null,
    border_radius: 0,
    clip_path: null,
    face_detect: false,
  };
}

function makeRectLayer(name: string, color: string): RectangleLayer {
  return {
    ...baseLayer(name),
    type: "rectangle",
    color,
    gradient: null,
    border_radius: 0,
    border: null,
  };
}

const TEXT_LAYER = makeTextLayer("headline", "Original headline");
const IMAGE_LAYER = makeImageLayer("bg_image", "https://placeholder.com/original.jpg");
const RECT_LAYER = makeRectLayer("bg_rect", "#000000");

// ─── applyModifications ───────────────────────────────────────────────────────

describe("applyModifications", () => {
  it("returns layers unchanged when modifications is empty", () => {
    const layers: Layer[] = [TEXT_LAYER, IMAGE_LAYER, RECT_LAYER];
    const result = applyModifications(layers, []);
    expect(result).toStrictEqual(layers);
    // Verify identity (no unnecessary copies when no mods)
    expect(result).toBe(layers);
  });

  it("applies text modification to a text layer", () => {
    const layers: Layer[] = [TEXT_LAYER];
    const result = applyModifications(layers, [{ name: "headline", text: "New Headline" }]);

    const modified = result[0] as TextLayer;
    expect(modified.text).toBe("New Headline");
    // Other properties unchanged
    expect(modified.font_family).toBe("Inter");
    expect(modified.color).toBe("#ffffff");
  });

  it("applies image_url modification to an image layer", () => {
    const layers: Layer[] = [IMAGE_LAYER];
    const result = applyModifications(layers, [
      { name: "bg_image", image_url: "https://cdn.example.com/new.jpg" },
    ]);

    const modified = result[0] as ImageLayer;
    expect(modified.image_url).toBe("https://cdn.example.com/new.jpg");
    expect(modified.fill).toBe("cover"); // unchanged
  });

  it("applies color modification to a rectangle layer", () => {
    const layers: Layer[] = [RECT_LAYER];
    const result = applyModifications(layers, [{ name: "bg_rect", color: "#ff0000" }]);

    const modified = result[0] as RectangleLayer;
    expect(modified.color).toBe("#ff0000");
  });

  it("leaves unmatched layers untouched", () => {
    const layers: Layer[] = [TEXT_LAYER, IMAGE_LAYER];
    const result = applyModifications(layers, [{ name: "unknown_layer", text: "ignored" }]);

    expect((result[0] as TextLayer).text).toBe("Original headline");
    expect((result[1] as ImageLayer).image_url).toBe("https://placeholder.com/original.jpg");
  });

  it("applies multiple modifications in one call", () => {
    const layers: Layer[] = [TEXT_LAYER, IMAGE_LAYER, RECT_LAYER];
    const result = applyModifications(layers, [
      { name: "headline", text: "Multi Mod Text" },
      { name: "bg_image", image_url: "https://cdn.example.com/multi.jpg" },
      { name: "bg_rect", color: "#0000ff" },
    ]);

    expect((result[0] as TextLayer).text).toBe("Multi Mod Text");
    expect((result[1] as ImageLayer).image_url).toBe("https://cdn.example.com/multi.jpg");
    expect((result[2] as RectangleLayer).color).toBe("#0000ff");
  });

  it("last-write-wins for duplicate modification keys", () => {
    const layers: Layer[] = [TEXT_LAYER];
    const result = applyModifications(layers, [
      { name: "headline", text: "First" },
      { name: "headline", text: "Second" }, // should win
    ]);

    expect((result[0] as TextLayer).text).toBe("Second");
  });

  it("preserves layer order", () => {
    const layers: Layer[] = [TEXT_LAYER, RECT_LAYER, IMAGE_LAYER];
    const result = applyModifications(layers, [{ name: "headline", text: "X" }]);

    expect(result[0].name).toBe("headline");
    expect(result[1].name).toBe("bg_rect");
    expect(result[2].name).toBe("bg_image");
  });

  it("golden: deterministic output — same input produces identical result", () => {
    const layers: Layer[] = [TEXT_LAYER, IMAGE_LAYER];
    const mods = [
      { name: "headline", text: "Deterministic" },
      { name: "bg_image", image_url: "https://cdn.example.com/det.jpg" },
    ];

    const result1 = applyModifications(layers, mods);
    const result2 = applyModifications(layers, mods);

    expect(result1).toStrictEqual(result2);
    expect((result1[0] as TextLayer).text).toBe("Deterministic");
    expect((result1[1] as ImageLayer).image_url).toBe("https://cdn.example.com/det.jpg");
  });
});
