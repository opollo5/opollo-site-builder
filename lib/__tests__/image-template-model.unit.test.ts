import { describe, it, expect } from "vitest";
import {
  TEMPLATE_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  isV1Layer,
} from "@/lib/image/template-model";
import type {
  Template,
  TextLayer,
  ImageLayer,
  RectangleLayer,
  Layer,
  Modification,
  Variant,
  Op,
  GenerationRequest,
} from "@/lib/image/template-model";

// ─── Schema version constants ─────────────────────────────────────────────────

describe("schema version constants", () => {
  it("TEMPLATE_SCHEMA_VERSION is 2", () => {
    expect(TEMPLATE_SCHEMA_VERSION).toBe(2);
  });

  it("LEGACY_SCHEMA_VERSION is 1", () => {
    expect(LEGACY_SCHEMA_VERSION).toBe(1);
  });

  it("versions are distinct", () => {
    expect(TEMPLATE_SCHEMA_VERSION).not.toBe(LEGACY_SCHEMA_VERSION);
  });
});

// ─── isV1Layer type guard ─────────────────────────────────────────────────────

describe("isV1Layer", () => {
  const base = {
    id: "layer_001",
    name: "title",
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    opacity: 1,
    locked: false,
    hide: false,
    hide_when_empty: false,
    lock_aspect_ratio: false,
    description: "",
    group: null,
    constraints: { horizontal: "left" as const, vertical: "top" as const },
  };

  it("returns true for a text layer", () => {
    const layer: TextLayer = {
      ...base,
      type: "text",
      text: "Hello",
      font_family: "Inter",
      font_size: 32,
      font_weight: 700,
      color: "#ffffff",
      text_align_h: "left",
      text_align_v: "top",
      letter_spacing: 0,
      line_height: 1.2,
      text_transform: "none",
      text_decoration: "none",
      word_break: "normal",
      style: "",
      direction: "ltr",
      text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
      truncate: false,
      text_box: { padding: null, border: null },
      background: {
        color: null, border: null, border_width: null,
        padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null,
      },
      secondary: { font_family: null, color: null },
    };
    expect(isV1Layer(layer)).toBe(true);
  });

  it("returns true for an image layer", () => {
    const layer: ImageLayer = {
      ...base,
      type: "image",
      asset_id: null,
      image_url: "https://example.com/img.jpg",
      fill: "cover",
      anchor_x: "center",
      anchor_y: "center",
      tint_color: null,
      border_radius: 0,
      clip_path: null,
      face_detect: false,
    };
    expect(isV1Layer(layer)).toBe(true);
  });

  it("returns true for a rectangle layer", () => {
    const layer: RectangleLayer = {
      ...base,
      type: "rectangle",
      color: "#7A1FA2",
      gradient: null,
      border_radius: 0,
      border: null,
    };
    expect(isV1Layer(layer)).toBe(true);
  });

  it("returns false for a reserved svg layer", () => {
    const layer: Layer = { ...base, type: "svg" };
    expect(isV1Layer(layer)).toBe(false);
  });

  it("returns false for a reserved qr layer", () => {
    const layer: Layer = { ...base, type: "qr" };
    expect(isV1Layer(layer)).toBe(false);
  });

  it("returns false for a reserved barcode layer", () => {
    const layer: Layer = { ...base, type: "barcode" };
    expect(isV1Layer(layer)).toBe(false);
  });

  it("returns false for a reserved chart layer", () => {
    const layer: Layer = { ...base, type: "chart" };
    expect(isV1Layer(layer)).toBe(false);
  });
});

// ─── Modification shape ───────────────────────────────────────────────────────

describe("Modification", () => {
  it("accepts a text modification", () => {
    const mod: Modification = { name: "title", text: "New Episode Title *Here*" };
    expect(mod.name).toBe("title");
    expect(mod.text).toBe("New Episode Title *Here*");
  });

  it("accepts an image modification with asset_id", () => {
    const mod: Modification = { name: "image-container", asset_id: "asset_77b0" };
    expect(mod.asset_id).toBe("asset_77b0");
  });

  it("accepts an image modification with image_url", () => {
    const mod: Modification = {
      name: "image-container",
      image_url: "https://example.com/guest.jpg",
    };
    expect(mod.image_url).toBe("https://example.com/guest.jpg");
  });

  it("accepts a colour override on a text layer", () => {
    const mod: Modification = { name: "title", color: "#FFE500" };
    expect(mod.color).toBe("#FFE500");
  });

  it("accepts a hide override", () => {
    const mod: Modification = { name: "subtitle", hide: true };
    expect(mod.hide).toBe(true);
  });
});

// ─── Variant shape ────────────────────────────────────────────────────────────

describe("Variant", () => {
  it("constructs a variant with no overrides", () => {
    const v: Variant = { key: "instagram_story", width: 1080, height: 1920, overrides: [] };
    expect(v.key).toBe("instagram_story");
    expect(v.overrides).toHaveLength(0);
  });

  it("constructs a variant with per-layer overrides", () => {
    const v: Variant = {
      key: "instagram_square",
      width: 1080,
      height: 1080,
      overrides: [
        { name: "title", font_size: 64 },
        { name: "subtitle", hide: true },
      ],
    };
    expect(v.overrides).toHaveLength(2);
    expect(v.overrides[0].name).toBe("title");
    expect(v.overrides[1].hide).toBe(true);
  });
});

// ─── Op union ─────────────────────────────────────────────────────────────────

describe("Op union discriminants", () => {
  it("move op has the expected shape", () => {
    const op: Op = { t: "move", id: "layer_001", from: { x: 0, y: 0 }, to: { x: 10, y: 20 } };
    expect(op.t).toBe("move");
  });

  it("resize op has the expected shape", () => {
    const op: Op = { t: "resize", id: "layer_001", from: { width: 100, height: 50 }, to: { width: 200, height: 100 } };
    expect(op.t).toBe("resize");
  });

  it("set op has the expected shape", () => {
    const op: Op = { t: "set", id: "layer_001", key: "color", from: "#fff", to: "#000" };
    expect(op.t).toBe("set");
  });

  it("reorder op has the expected shape", () => {
    const op: Op = { t: "reorder", id: "layer_001", from: 0, to: 3 };
    expect(op.t).toBe("reorder");
  });

  it("batch op nests other ops", () => {
    const op: Op = {
      t: "batch",
      ops: [
        { t: "move", id: "layer_001", from: { x: 0, y: 0 }, to: { x: 10, y: 20 } },
        { t: "set", id: "layer_001", key: "opacity", from: 1, to: 0.5 },
      ],
    };
    expect(op.t).toBe("batch");
    if (op.t === "batch") {
      expect(op.ops).toHaveLength(2);
    }
  });
});

// ─── GenerationRequest shape ──────────────────────────────────────────────────

describe("GenerationRequest", () => {
  it("constructs a minimal request (no variant, no render_settings override)", () => {
    const req: GenerationRequest = {
      template: "tmpl_abc123",
      modifications: [{ name: "title", text: "Hello World" }],
    };
    expect(req.template).toBe("tmpl_abc123");
    expect(req.variant).toBeUndefined();
    expect(req.modifications).toHaveLength(1);
  });

  it("constructs a full request with variant and render_settings override", () => {
    const req: GenerationRequest = {
      template: "tmpl_abc123",
      variant: "instagram_square",
      modifications: [{ name: "title", text: "Hello" }],
      render_settings: { format: "jpg", scale: 2 },
    };
    expect(req.variant).toBe("instagram_square");
    expect(req.render_settings?.format).toBe("jpg");
    expect(req.render_settings?.scale).toBe(2);
  });
});
