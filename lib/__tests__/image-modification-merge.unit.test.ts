/**
 * Unit tests for E9 — modification merge resolution order (§1.5).
 *
 * Validates the full three-stage resolution: base → variant override → request.
 * This is the acceptance test for the complete modification pipeline.
 *
 * Acceptance tests covered:
 *  - #5: per-variant override hides subtitle in that variant only
 *  - §1.5: unknown modification names are ignored
 *  - §1.5: request modification wins over variant override (last wins)
 *  - multiple modifications for the same layer name are merged (last-write wins)
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
  applyModifications,
  applyVariant,
} from "@/lib/image/compositing/layer-renderer";

import type { Layer, TextLayer, RectangleLayer, Variant } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeText(name: string, text: string, overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: `id_${name}`, name, type: "text",
    x: 0, y: 0, width: 200, height: 80,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0, opacity: 1,
    locked: false, hide: false, hide_when_empty: false,
    lock_aspect_ratio: false, description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
    text, font_family: "Inter", font_size: 32, font_weight: 700,
    color: "#ffffff",
    text_align_h: "left", text_align_v: "top",
    letter_spacing: 0, line_height: 1.2,
    text_transform: "none", text_decoration: "none",
    word_break: "normal", style: "", direction: "ltr",
    text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
    truncate: false,
    text_box: { padding: null, border: null },
    background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null },
    secondary: { font_family: null, color: null },
    ...overrides,
  };
}

// ─── applyModifications ───────────────────────────────────────────────────────

describe("applyModifications — §1.5", () => {
  it("text modification overrides the text field", () => {
    const layers: Layer[] = [makeText("title", "Original")];
    const result = applyModifications(layers, [{ name: "title", text: "Modified" }]);
    expect((result[0] as TextLayer).text).toBe("Modified");
  });

  it("color modification overrides the color field", () => {
    const layers: Layer[] = [makeText("title", "Hello")];
    const result = applyModifications(layers, [{ name: "title", color: "#FF0000" }]);
    expect((result[0] as TextLayer).color).toBe("#FF0000");
  });

  it("hide=true hides the layer", () => {
    const layers: Layer[] = [makeText("subtitle", "Sub")];
    const result = applyModifications(layers, [{ name: "subtitle", hide: true }]);
    expect(result[0].hide).toBe(true);
  });

  it("unknown layer name is ignored (no error, no change)", () => {
    const layers: Layer[] = [makeText("title", "Hello")];
    const result = applyModifications(layers, [{ name: "does_not_exist", text: "X" }]);
    expect(result).toHaveLength(1);
    expect((result[0] as TextLayer).text).toBe("Hello");
  });

  it("multiple modifications for the same name merge (last-write wins)", () => {
    const layers: Layer[] = [makeText("title", "Original")];
    const result = applyModifications(layers, [
      { name: "title", text: "First" },
      { name: "title", color: "#FF0000" },
      { name: "title", text: "Last" },
    ]);
    expect((result[0] as TextLayer).text).toBe("Last");
    expect((result[0] as TextLayer).color).toBe("#FF0000");
  });

  it("unmodified fields on a modified layer are preserved", () => {
    const layers: Layer[] = [makeText("title", "Hello", { font_size: 48 })];
    const result = applyModifications(layers, [{ name: "title", text: "Modified" }]);
    expect((result[0] as TextLayer).font_size).toBe(48);
    expect((result[0] as TextLayer).id).toBe("id_title");
  });

  it("empty modifications list returns layers unchanged", () => {
    const layers: Layer[] = [makeText("title", "Hello")];
    const result = applyModifications(layers, []);
    expect(result).toBe(layers); // exact reference — no copy made
  });

  it("multiple layers: only the matching one is modified", () => {
    const layers: Layer[] = [
      makeText("title", "Title"),
      makeText("subtitle", "Subtitle"),
    ];
    const result = applyModifications(layers, [{ name: "title", text: "New Title" }]);
    expect((result[0] as TextLayer).text).toBe("New Title");
    expect((result[1] as TextLayer).text).toBe("Subtitle");
  });
});

// ─── Full 3-stage pipeline: base → variant override → request (§1.5) ─────────

describe("three-stage resolution order — §1.5", () => {
  const BASE_LAYERS: Layer[] = [
    makeText("title",    "Base Title",    { font_size: 32 }),
    makeText("subtitle", "Base Subtitle", { hide: false }),
    makeText("caption",  "Base Caption",  { color: "#ffffff" }),
  ];

  const VARIANT: Variant = {
    key: "instagram_square",
    width: 1080, height: 1080,
    overrides: [
      { name: "subtitle", hide: true },        // hide subtitle in this variant
      { name: "title",    font_size: 64 },      // larger title in this variant
    ],
  };

  it("acceptance test #5: variant override hides subtitle in that variant only", () => {
    const template = { width: 1280, height: 720, layers: BASE_LAYERS };
    const { layers } = applyVariant(template, VARIANT);
    const subtitle = layers.find((l) => l.name === "subtitle")!;
    const title    = layers.find((l) => l.name === "title")!;
    expect(subtitle.hide).toBe(true);
    expect(title.hide).toBe(false); // title not hidden
  });

  it("base template: subtitle is not hidden", () => {
    const subtitle = BASE_LAYERS.find((l) => l.name === "subtitle")!;
    expect(subtitle.hide).toBe(false);
  });

  it("stage 1→2: variant override wins over base", () => {
    const template = { width: 1280, height: 720, layers: BASE_LAYERS };
    const { layers } = applyVariant(template, VARIANT);
    const title = layers.find((l) => l.name === "title")! as TextLayer;
    expect(title.font_size).toBe(64); // variant override applied
  });

  it("stage 2→3: request modification wins over variant override", () => {
    // variant sets title.font_size=64; request sets it to 80
    const template = { width: 1280, height: 720, layers: BASE_LAYERS };
    const { layers: variantLayers } = applyVariant(template, VARIANT);
    const requestLayers = applyModifications(variantLayers, [
      { name: "title", font_size: 80 },
    ]);
    const title = requestLayers.find((l) => l.name === "title")! as TextLayer;
    expect(title.font_size).toBe(80); // request wins over variant
  });

  it("stage 1→3: request modification wins over base (no variant)", () => {
    const requestLayers = applyModifications(BASE_LAYERS, [
      { name: "caption", color: "#FF0000" },
    ]);
    const caption = requestLayers.find((l) => l.name === "caption")! as TextLayer;
    expect(caption.color).toBe("#FF0000");
  });

  it("layers without modifications at any stage are preserved unchanged", () => {
    const template = { width: 1280, height: 720, layers: BASE_LAYERS };
    const { layers: variantLayers } = applyVariant(template, VARIANT);
    const requestLayers = applyModifications(variantLayers, [
      { name: "title", text: "New Title" },
    ]);
    const caption = requestLayers.find((l) => l.name === "caption")! as TextLayer;
    // caption has no variant override and no request modification
    expect(caption.text).toBe("Base Caption");
    expect(caption.color).toBe("#ffffff");
  });

  it("modification of a variant-hidden layer: layer stays hidden (merged, not restored)", () => {
    const template = { width: 1280, height: 720, layers: BASE_LAYERS };
    const { layers: variantLayers } = applyVariant(template, VARIANT);
    // subtitle is hidden by variant override; send text modification for it
    const requestLayers = applyModifications(variantLayers, [
      { name: "subtitle", text: "Override Text" },
    ]);
    const subtitle = requestLayers.find((l) => l.name === "subtitle")!;
    // text is updated but hide was not explicitly reversed → still hidden
    expect(subtitle.hide).toBe(true);
    expect((subtitle as TextLayer).text).toBe("Override Text");
  });
});
