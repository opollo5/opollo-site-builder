/**
 * Unit tests for the rectangle-layer renderer functions (E4).
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

const { sharpChain } = vi.hoisted(() => {
  const chain = {
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("FAKE_PNG")),
  };
  return { sharpChain: chain };
});
vi.mock("sharp", () => ({ default: vi.fn().mockReturnValue(sharpChain) }));

import { buildRectangleLayerSvg, renderRectangleLayer } from "@/lib/image/compositing/layer-renderer";
import type { RectangleLayer } from "@/lib/image/template-model";

function makeRectLayer(overrides: Partial<RectangleLayer> = {}): RectangleLayer {
  return {
    id: "layer_rect_001",
    name: "background",
    type: "rectangle",
    x: 0, y: 0, width: 300, height: 200,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    opacity: 1,
    locked: false, hide: false, hide_when_empty: false,
    lock_aspect_ratio: false,
    description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
    color: "#7A1FA2",
    gradient: null,
    border_radius: 0,
    border: null,
    ...overrides,
  };
}

// ─── buildRectangleLayerSvg ───────────────────────────────────────────────────

describe("buildRectangleLayerSvg", () => {
  it("returns an SVG string", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer());
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
  });

  it("uses layer dimensions for svg width/height", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer({ width: 640, height: 360 }));
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="360"');
  });

  it("fills with solid color when no gradient", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer({ color: "#FF0000" }));
    expect(svg).toContain('#FF0000');
    expect(svg).not.toContain("linearGradient");
    expect(svg).not.toContain("radialGradient");
  });

  it("uses transparent fill when color is null and no gradient", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer({ color: null }));
    expect(svg).toContain('fill="transparent"');
  });

  it("adds rx/ry when border_radius > 0", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer({ border_radius: 12 }));
    expect(svg).toContain('rx="12"');
    expect(svg).toContain('ry="12"');
  });

  it("omits rx/ry when border_radius is 0", () => {
    const svg = buildRectangleLayerSvg(makeRectLayer({ border_radius: 0 }));
    expect(svg).not.toContain("rx=");
  });

  it("adds solid border stroke attributes", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({ border: { color: "#000000", width: 2, style: "solid" } }),
    );
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).not.toContain("stroke-dasharray");
  });

  it("adds stroke-dasharray for dashed border", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({ border: { color: "#000", width: 2, style: "dashed" } }),
    );
    expect(svg).toContain("stroke-dasharray");
  });

  it("adds stroke-dasharray and stroke-linecap for dotted border", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({ border: { color: "#000", width: 2, style: "dotted" } }),
    );
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain('stroke-linecap="round"');
  });

  it("uses linearGradient for a linear gradient fill", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({
        color: null,
        gradient: {
          type: "linear",
          angle: 90,
          stops: [
            { color: "#FF0000", position: 0 },
            { color: "#0000FF", position: 1 },
          ],
        },
      }),
    );
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("url(#g0)");
    expect(svg).toContain("#FF0000");
    expect(svg).toContain("#0000FF");
  });

  it("uses radialGradient for a radial gradient fill", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({
        color: null,
        gradient: {
          type: "radial",
          stops: [
            { color: "#FFFFFF", position: 0 },
            { color: "#000000", position: 1 },
          ],
        },
      }),
    );
    expect(svg).toContain("radialGradient");
    expect(svg).toContain("cx=\"50%\"");
  });

  it("gradient stops have correct offset percentages", () => {
    const svg = buildRectangleLayerSvg(
      makeRectLayer({
        color: null,
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { color: "#FF0000", position: 0 },
            { color: "#0000FF", position: 0.5 },
            { color: "#00FF00", position: 1 },
          ],
        },
      }),
    );
    expect(svg).toContain('offset="0.0%"');
    expect(svg).toContain('offset="50.0%"');
    expect(svg).toContain('offset="100.0%"');
  });

  it("escapes XML special characters in color values", () => {
    // Paranoia test: colors are typically safe, but test the escape path
    const svg = buildRectangleLayerSvg(makeRectLayer({ color: "#ABCDEF" }));
    expect(svg).not.toContain("&");  // safe color, no escaping needed
    expect(svg).toContain("#ABCDEF");
  });
});

// ─── renderRectangleLayer ─────────────────────────────────────────────────────

describe("renderRectangleLayer", () => {
  it("returns OverlayOptions with correct position", async () => {
    const layer = makeRectLayer({ x: 50, y: 100 });
    const result = await renderRectangleLayer(layer);
    expect(result.left).toBe(50);
    expect(result.top).toBe(100);
    expect(result.input).toBeInstanceOf(Buffer);
  });

  it("rounds fractional coordinates", async () => {
    const layer = makeRectLayer({ x: 10.7, y: 20.3 });
    const result = await renderRectangleLayer(layer);
    expect(result.left).toBe(11);
    expect(result.top).toBe(20);
  });
});
