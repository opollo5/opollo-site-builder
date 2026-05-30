/**
 * Unit tests for E8 — compositeImage() dispatch + backward-compat.
 *
 * Verifies:
 *  - schema_version=2 input → layer-based renderer path
 *  - legacy input (no schema_version) → existing sharp-renderer path
 *  - CompositeResult shape is consistent across both paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
}));
vi.mock("sharp", () => ({ default: vi.fn() }));

// Mock the two downstream compositors so we can track which one is called.
const mockCompositeSharp = vi.fn().mockResolvedValue({
  storagePath: "legacy/path.jpg",
  provider: "sharp_native",
  durationMs: 10,
});
vi.mock("@/lib/image/compositing/sharp-renderer", () => ({
  compositeSharp: mockCompositeSharp,
}));

const mockCompositeLayerBased = vi.fn().mockResolvedValue({
  storagePath: "layer/path.png",
  provider: "sharp_layer_native",
  durationMs: 20,
});
vi.mock("@/lib/image/compositing/layer-composite", () => ({
  compositeLayerBased: mockCompositeLayerBased,
}));

import { compositeImage } from "@/lib/image/compositing/index";
import type { CompositeInput, LayerCompositeInput } from "@/lib/image/compositing/index";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LEGACY_INPUT: CompositeInput = {
  backgroundStoragePath: "company/generated/123-bg.jpg",
  textZones: [],
  logo: null,
  outputFormat: "jpeg",
  outputWidth: 1280,
  outputHeight: 720,
};

const LAYER_TEMPLATE = {
  width: 400, height: 200,
  background_color: "#000000",
  layers: [],
  render_settings: { format: "png" as const, quality: 100, scale: 1, dpi: 72 },
};

const LAYER_INPUT: LayerCompositeInput = {
  schema_version: 2,
  template: LAYER_TEMPLATE,
  outputStoragePath: "company/layer-composite/test.png",
};

// ─── Dispatch ─────────────────────────────────────────────────────────────────

describe("compositeImage dispatch", () => {
  beforeEach(() => {
    mockCompositeSharp.mockClear();
    mockCompositeLayerBased.mockClear();
  });

  it("routes legacy input (no schema_version) to compositeSharp", async () => {
    await compositeImage(LEGACY_INPUT);
    expect(mockCompositeSharp).toHaveBeenCalledTimes(1);
    expect(mockCompositeLayerBased).not.toHaveBeenCalled();
  });

  it("routes schema_version=2 input to compositeLayerBased", async () => {
    await compositeImage(LAYER_INPUT);
    expect(mockCompositeLayerBased).toHaveBeenCalledTimes(1);
    expect(mockCompositeSharp).not.toHaveBeenCalled();
  });

  it("passes the full input to compositeSharp unchanged", async () => {
    await compositeImage(LEGACY_INPUT);
    expect(mockCompositeSharp).toHaveBeenCalledWith(LEGACY_INPUT);
  });

  it("passes the full input to compositeLayerBased unchanged", async () => {
    await compositeImage(LAYER_INPUT);
    expect(mockCompositeLayerBased).toHaveBeenCalledWith(LAYER_INPUT);
  });

  it("returns the CompositeResult from the legacy path", async () => {
    const result = await compositeImage(LEGACY_INPUT);
    expect(result.storagePath).toBe("legacy/path.jpg");
    expect(result.provider).toBe("sharp_native");
    expect(typeof result.durationMs).toBe("number");
  });

  it("returns the CompositeResult from the layer-based path", async () => {
    const result = await compositeImage(LAYER_INPUT);
    expect(result.storagePath).toBe("layer/path.png");
    expect(result.provider).toBe("sharp_layer_native");
    expect(typeof result.durationMs).toBe("number");
  });

  it("TEMPLATE_SCHEMA_VERSION=2 matches the schema_version discriminator", () => {
    expect(TEMPLATE_SCHEMA_VERSION).toBe(2);
    expect(LAYER_INPUT.schema_version).toBe(TEMPLATE_SCHEMA_VERSION);
  });
});

// ─── LayerCompositeInput shape ────────────────────────────────────────────────

describe("LayerCompositeInput shape", () => {
  it("accepts optional modifications", async () => {
    const input: LayerCompositeInput = {
      ...LAYER_INPUT,
      modifications: [{ name: "title", text: "New Text" }],
    };
    await compositeImage(input);
    expect(mockCompositeLayerBased).toHaveBeenCalledWith(input);
  });

  it("accepts optional variantKey", async () => {
    const input: LayerCompositeInput = {
      ...LAYER_INPUT,
      variantKey: "instagram_square",
    };
    await compositeImage(input);
    expect(mockCompositeLayerBased).toHaveBeenCalledWith(input);
  });

  it("accepts optional outputFormat override", async () => {
    const input: LayerCompositeInput = {
      ...LAYER_INPUT,
      outputFormat: "jpeg",
    };
    await compositeImage(input);
    expect(mockCompositeLayerBased).toHaveBeenCalledWith(input);
  });
});
