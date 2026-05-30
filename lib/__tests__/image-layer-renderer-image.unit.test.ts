/**
 * Unit tests for the image-layer renderer functions (E3).
 *
 * Tests cover:
 *   - resolveImageUrl: asset_id fallback, image_url passthrough, null handling
 *   - buildSharpPosition: all 9 anchor combinations
 *   - renderImageLayer: fetch failure, no-url null, successful render,
 *     hide_when_empty, overlay position
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

// Use vi.hoisted so sharpChain is defined before the vi.mock() factory is hoisted.
const { sharpChain } = vi.hoisted(() => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("FAKE_PNG")),
  };
  return { sharpChain: chain };
});
vi.mock("sharp", () => ({ default: vi.fn().mockReturnValue(sharpChain) }));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  resolveImageUrl,
  buildSharpPosition,
  renderImageLayer,
} from "@/lib/image/compositing/layer-renderer";
import type { ImageLayer } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeImageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: "layer_img_001",
    name: "image-container",
    type: "image",
    x: 0, y: 0, width: 400, height: 300,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    opacity: 1,
    locked: false, hide: false, hide_when_empty: false,
    lock_aspect_ratio: false,
    description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
    asset_id: null,
    image_url: "https://example.com/photo.jpg",
    fill: "cover",
    anchor_x: "center",
    anchor_y: "center",
    tint_color: null,
    border_radius: 0,
    clip_path: null,
    face_detect: false,
    ...overrides,
  };
}

// ─── resolveImageUrl ──────────────────────────────────────────────────────────

describe("resolveImageUrl", () => {
  it("returns image_url when asset_id is null", async () => {
    const layer = makeImageLayer({ asset_id: null, image_url: "https://example.com/img.jpg" });
    const url = await resolveImageUrl(layer);
    expect(url).toBe("https://example.com/img.jpg");
  });

  it("returns image_url when asset_id is set (fallback path, logs warning)", async () => {
    const layer = makeImageLayer({ asset_id: "asset_abc", image_url: "https://example.com/img.jpg" });
    const url = await resolveImageUrl(layer);
    expect(url).toBe("https://example.com/img.jpg");
  });

  it("returns null when both asset_id and image_url are null", async () => {
    const layer = makeImageLayer({ asset_id: null, image_url: null });
    const url = await resolveImageUrl(layer);
    expect(url).toBeNull();
  });
});

// ─── buildSharpPosition ───────────────────────────────────────────────────────

describe("buildSharpPosition", () => {
  it("center/center → 'centre'", () => {
    expect(buildSharpPosition("center", "center")).toBe("centre");
  });
  it("left/top → 'northwest'", () => {
    expect(buildSharpPosition("left", "top")).toBe("northwest");
  });
  it("right/top → 'northeast'", () => {
    expect(buildSharpPosition("right", "top")).toBe("northeast");
  });
  it("left/bottom → 'southwest'", () => {
    expect(buildSharpPosition("left", "bottom")).toBe("southwest");
  });
  it("right/bottom → 'southeast'", () => {
    expect(buildSharpPosition("right", "bottom")).toBe("southeast");
  });
  it("center/top → 'north'", () => {
    expect(buildSharpPosition("center", "top")).toBe("north");
  });
  it("center/bottom → 'south'", () => {
    expect(buildSharpPosition("center", "bottom")).toBe("south");
  });
  it("left/center → 'west'", () => {
    expect(buildSharpPosition("left", "center")).toBe("west");
  });
  it("right/center → 'east'", () => {
    expect(buildSharpPosition("right", "center")).toBe("east");
  });
});

// ─── renderImageLayer ─────────────────────────────────────────────────────────

describe("renderImageLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharpChain.resize.mockReturnThis();
    sharpChain.png.mockReturnThis();
    sharpChain.composite.mockReturnThis();
    sharpChain.toBuffer.mockResolvedValue(Buffer.from("FAKE_PNG"));
  });

  function mockFetchOk(data = "IMAGE_BYTES") {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => Buffer.from(data).buffer,
    });
  }

  it("returns null when image_url is null and hide_when_empty is false", async () => {
    const layer = makeImageLayer({ asset_id: null, image_url: null });
    const result = await renderImageLayer(layer);
    expect(result).toBeNull();
  });

  it("returns null when image_url is null and hide_when_empty is true", async () => {
    const layer = makeImageLayer({ asset_id: null, image_url: null, hide_when_empty: true });
    const result = await renderImageLayer(layer);
    expect(result).toBeNull();
  });

  it("returns null when fetch fails (4xx)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const layer = makeImageLayer();
    const result = await renderImageLayer(layer);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));
    const layer = makeImageLayer();
    const result = await renderImageLayer(layer);
    expect(result).toBeNull();
  });

  it("returns OverlayOptions with correct left/top on success", async () => {
    mockFetchOk();
    const layer = makeImageLayer({ x: 100, y: 200 });
    const result = await renderImageLayer(layer);
    expect(result).not.toBeNull();
    expect(result?.left).toBe(100);
    expect(result?.top).toBe(200);
    expect(result?.input).toBeInstanceOf(Buffer);
  });

  it("rounds fractional layer.x / layer.y", async () => {
    mockFetchOk();
    const layer = makeImageLayer({ x: 10.7, y: 20.3 });
    const result = await renderImageLayer(layer);
    expect(result?.left).toBe(11);
    expect(result?.top).toBe(20);
  });

  it("calls sharp resize with correct dimensions and cover mode", async () => {
    mockFetchOk();
    const layer = makeImageLayer({ width: 640, height: 480, fill: "cover" });
    await renderImageLayer(layer);
    expect(sharpChain.resize).toHaveBeenCalledWith(
      640, 480,
      expect.objectContaining({ fit: "cover" }),
    );
  });

  it("uses contain fit for fill=fit", async () => {
    mockFetchOk();
    const layer = makeImageLayer({ fill: "fit" });
    await renderImageLayer(layer);
    expect(sharpChain.resize).toHaveBeenCalledWith(
      expect.any(Number), expect.any(Number),
      expect.objectContaining({ fit: "contain" }),
    );
  });

  it("composites a mask when border_radius > 0", async () => {
    mockFetchOk();
    // Need multiple toBuffer calls for the pipeline
    sharpChain.toBuffer
      .mockResolvedValueOnce(Buffer.from("RESIZED"))   // resize
      .mockResolvedValueOnce(Buffer.from("MASK_PNG"))  // mask SVG raster
      .mockResolvedValueOnce(Buffer.from("CLIPPED")); // after dest-in
    const layer = makeImageLayer({ border_radius: 8 });
    const result = await renderImageLayer(layer);
    expect(result).not.toBeNull();
    expect(sharpChain.composite).toHaveBeenCalled();
  });

  it("composites a tint when tint_color is set", async () => {
    mockFetchOk();
    sharpChain.toBuffer
      .mockResolvedValueOnce(Buffer.from("RESIZED"))
      .mockResolvedValueOnce(Buffer.from("TINT_PNG"))
      .mockResolvedValueOnce(Buffer.from("TINTED"));
    const layer = makeImageLayer({ tint_color: "#FF0000" });
    const result = await renderImageLayer(layer);
    expect(result).not.toBeNull();
    expect(sharpChain.composite).toHaveBeenCalled();
  });

  it("composites a clip_path mask when clip_path is set", async () => {
    mockFetchOk();
    sharpChain.toBuffer
      .mockResolvedValueOnce(Buffer.from("RESIZED"))
      .mockResolvedValueOnce(Buffer.from("CLIP_MASK"))
      .mockResolvedValueOnce(Buffer.from("CLIPPED"));
    const layer = makeImageLayer({ clip_path: "M0,0 L400,0 L300,300 L0,300 Z" });
    const result = await renderImageLayer(layer);
    expect(result).not.toBeNull();
    expect(sharpChain.composite).toHaveBeenCalled();
  });

  it("anchor_x/y is passed to sharp resize position", async () => {
    mockFetchOk();
    const layer = makeImageLayer({ anchor_x: "left", anchor_y: "top" });
    await renderImageLayer(layer);
    expect(sharpChain.resize).toHaveBeenCalledWith(
      expect.any(Number), expect.any(Number),
      expect.objectContaining({ position: "northwest" }),
    );
  });
});
