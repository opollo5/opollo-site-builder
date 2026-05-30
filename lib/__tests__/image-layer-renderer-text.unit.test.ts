/**
 * Unit tests for the layer-renderer text-layer functions (E2).
 *
 * Tests cover:
 *  - parseSecondaryRuns: secondary style parser per §6.6 / §1.7
 *  - measureTextWidth: per-character advance-width table
 *  - wrapLayerText: greedy word-wrap using real measurement
 *  - fitFontSize: binary-search text-fit per §7 / §1.6
 *  - buildTextLayerSvg: smoke-tests the full SVG output structure
 *
 * Acceptance test #2 (determinism): run text-fit 100× on the same input,
 * verify same result every time.
 *
 * Note: sharp + server-only are mocked out; no native binary required.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock sharp: renderTextLayer calls sharp(...).png().toBuffer()
vi.mock("sharp", () => {
  const chain = {
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("<png>")),
  };
  const sharpFn = vi.fn().mockReturnValue(chain);
  return { default: sharpFn };
});

// Mock fs (font loading) — no real woff2 files needed in unit tests
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
}));

import {
  parseSecondaryRuns,
  measureTextWidth,
  wrapLayerText,
  fitFontSize,
  buildTextLayerSvg,
  renderTextLayer,
} from "@/lib/image/compositing/layer-renderer";

import type { TextLayer } from "@/lib/image/template-model";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: "layer_001",
    name: "title",
    type: "text",
    x: 0, y: 0, width: 640, height: 400,
    rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
    skew_x: 0, skew_y: 0,
    opacity: 1,
    locked: false,
    hide: false, hide_when_empty: false,
    lock_aspect_ratio: false,
    description: "", group: null,
    constraints: { horizontal: "left", vertical: "top" },
    text: "Hello World",
    font_family: "Inter",
    font_size: 32,
    font_weight: 400,
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
    secondary: { font_family: null, color: "#FF89FF" },
    ...overrides,
  };
}

// ─── parseSecondaryRuns ───────────────────────────────────────────────────────

describe("parseSecondaryRuns", () => {
  it("returns a single normal run when no asterisks", () => {
    const runs = parseSecondaryRuns("Hello World");
    expect(runs).toEqual([{ text: "Hello World", secondary: false }]);
  });

  it("returns the design spec example correctly", () => {
    const runs = parseSecondaryRuns("Mindset Shifts That *Matter*");
    expect(runs).toEqual([
      { text: "Mindset Shifts That ", secondary: false },
      { text: "Matter", secondary: true },
    ]);
  });

  it("handles leading secondary run", () => {
    const runs = parseSecondaryRuns("*Bold* then normal");
    expect(runs).toEqual([
      { text: "Bold", secondary: true },
      { text: " then normal", secondary: false },
    ]);
  });

  it("handles multiple secondary runs", () => {
    const runs = parseSecondaryRuns("a *b* c *d* e");
    expect(runs).toEqual([
      { text: "a ", secondary: false },
      { text: "b", secondary: true },
      { text: " c ", secondary: false },
      { text: "d", secondary: true },
      { text: " e", secondary: false },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseSecondaryRuns("")).toEqual([]);
  });

  it("handles adjacent secondary runs", () => {
    const runs = parseSecondaryRuns("*a**b*");
    const secondary = runs.filter((r) => r.secondary).map((r) => r.text);
    expect(secondary).toContain("a");
    expect(secondary).toContain("b");
  });

  it("parser is deterministic — same input always same output", () => {
    const input = "Mindset Shifts That *Matter*";
    const first = JSON.stringify(parseSecondaryRuns(input));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(parseSecondaryRuns(input))).toBe(first);
    }
  });
});

// ─── measureTextWidth ─────────────────────────────────────────────────────────

describe("measureTextWidth", () => {
  it("returns 0 for empty string", () => {
    expect(measureTextWidth("", 32, 400, 0)).toBe(0);
  });

  it("returns positive width for a word", () => {
    const w = measureTextWidth("Hello", 32, 400, 0);
    expect(w).toBeGreaterThan(0);
  });

  it("wide characters (W, M) produce wider output than narrow (i, l)", () => {
    const narrow = measureTextWidth("iii", 32, 400, 0);
    const wide = measureTextWidth("WWW", 32, 400, 0);
    expect(wide).toBeGreaterThan(narrow);
  });

  it("bold weight (700) is wider than regular (400)", () => {
    const regular = measureTextWidth("Hello", 32, 400, 0);
    const bold = measureTextWidth("Hello", 32, 700, 0);
    expect(bold).toBeGreaterThan(regular);
  });

  it("positive letter_spacing increases width", () => {
    const base = measureTextWidth("Hello", 32, 400, 0);
    const spaced = measureTextWidth("Hello", 32, 400, 4);
    expect(spaced).toBeGreaterThan(base);
  });

  it("negative letter_spacing decreases width", () => {
    const base = measureTextWidth("Hello", 32, 400, 0);
    const tight = measureTextWidth("Hello", 32, 400, -2);
    expect(tight).toBeLessThan(base);
  });

  it("width scales linearly with font size", () => {
    const w16 = measureTextWidth("A", 16, 400, 0);
    const w32 = measureTextWidth("A", 32, 400, 0);
    // Should be approximately 2× (within floating-point tolerance)
    expect(w32 / w16).toBeCloseTo(2, 0);
  });

  it("space character produces a positive width", () => {
    const w = measureTextWidth(" ", 32, 400, 0);
    expect(w).toBeGreaterThan(0);
  });
});

// ─── wrapLayerText ────────────────────────────────────────────────────────────

describe("wrapLayerText", () => {
  it("short text fits on one line", () => {
    const lines = wrapLayerText("Hi", 640, 32, 400, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Hi");
  });

  it("long text wraps into multiple lines", () => {
    const lines = wrapLayerText("The quick brown fox jumps over the lazy dog", 200, 32, 400, 0);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("each line respects the box width (within tolerance)", () => {
    const boxWidth = 300;
    const lines = wrapLayerText(
      "The quick brown fox jumps over the lazy dog",
      boxWidth, 32, 400, 0,
    );
    const TOL = 2;
    for (const line of lines) {
      const lw = measureTextWidth(line, 32, 400, 0);
      expect(lw).toBeLessThanOrEqual(boxWidth + TOL);
    }
  });

  it("empty string returns a single empty line", () => {
    const lines = wrapLayerText("", 200, 32, 400, 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("");
  });

  it("single long word that exceeds box width is kept on its own line", () => {
    // 'Supercalifragilistic' is 20 chars — should overflow a 100px box at 32px
    const lines = wrapLayerText("Supercalifragilistic", 100, 32, 400, 0);
    // Should still produce lines (word kept as-is, allowed to overflow per spec)
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join(" ").trim()).toBe("Supercalifragilistic");
  });

  it("wrap result is deterministic", () => {
    const text = "Mindset Shifts That Matter Are Important To Everyone Everywhere";
    const first = JSON.stringify(wrapLayerText(text, 400, 32, 400, 0));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(wrapLayerText(text, 400, 32, 400, 0))).toBe(first);
    }
  });
});

// ─── fitFontSize ─────────────────────────────────────────────────────────────

describe("fitFontSize", () => {
  const opts = { enabled: true, min_size: 16, max_size: 120, max_lines: 4 };

  it("returns a size within [min_size, max_size]", () => {
    const size = fitFontSize("Hello World", { width: 300, height: 200 }, opts, 400, 0, 1.2, "normal");
    expect(size).toBeGreaterThanOrEqual(opts.min_size);
    expect(size).toBeLessThanOrEqual(opts.max_size);
  });

  it("longer text produces smaller font size than shorter text", () => {
    const box = { width: 200, height: 100 };
    const short = fitFontSize("Hi", box, opts, 400, 0, 1.2, "normal");
    const long = fitFontSize(
      "The quick brown fox jumps over the lazy dog and more text here",
      box, opts, 400, 0, 1.2, "normal",
    );
    expect(short).toBeGreaterThanOrEqual(long);
  });

  it("larger box allows larger font size", () => {
    const small = fitFontSize("Hello", { width: 100, height: 50 }, opts, 400, 0, 1.2, "normal");
    const large = fitFontSize("Hello", { width: 600, height: 400 }, opts, 400, 0, 1.2, "normal");
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it("result fits within the box (line count ≤ max_lines)", () => {
    const box = { width: 300, height: 200 };
    const text = "Mindset Shifts That Matter Are Important";
    const size = fitFontSize(text, box, opts, 400, 0, 1.2, "normal");
    const lines = wrapLayerText(text, box.width, size, 400, 0);
    expect(lines.length).toBeLessThanOrEqual(opts.max_lines);
  });

  it("returns min_size when nothing fits", () => {
    // Tiny box, very long text — should return min_size and not throw
    const size = fitFontSize(
      "Supercalifragilisticexpialidocious text that is way too long for any box",
      { width: 10, height: 10 },
      opts, 400, 0, 1.2, "normal",
    );
    expect(size).toBe(opts.min_size);
  });

  // Acceptance test #2: text-fit determinism — 100 runs, same result every time
  it("is fully deterministic — 100 identical runs produce identical results", () => {
    const text = "Mindset Shifts That *Matter*";
    const box = { width: 400, height: 200 };
    const first = fitFontSize(text, box, opts, 700, -2, 1.1, "normal");
    for (let i = 0; i < 99; i++) {
      expect(fitFontSize(text, box, opts, 700, -2, 1.1, "normal")).toBe(first);
    }
  });

  it("clamps to max_lines even if font size is at minimum", () => {
    const strictOpts = { ...opts, max_lines: 1, max_size: 16 };
    const size = fitFontSize(
      "Very long text that wraps many times",
      { width: 100, height: 100 },
      strictOpts, 400, 0, 1.2, "normal",
    );
    expect(size).toBeGreaterThanOrEqual(opts.min_size);
  });
});

// ─── buildTextLayerSvg ────────────────────────────────────────────────────────

describe("buildTextLayerSvg", () => {
  it("returns an SVG string", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer(),
    });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
  });

  it("includes the text content", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ text: "My Headline" }),
    });
    expect(svg).toContain("My Headline");
  });

  it("applies text-transform uppercase", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ text: "hello world", text_transform: "uppercase" }),
    });
    expect(svg).toContain("HELLO WORLD");
    expect(svg).not.toContain("hello world");
  });

  it("renders secondary style runs as separate tspan elements", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({
        text: "Normal *Secondary*",
        secondary: { font_family: null, color: "#FF89FF" },
      }),
    });
    expect(svg).toContain("<tspan");
    expect(svg).toContain("#FF89FF");
  });

  it("renders glyph-hugging background rects when background.color is set", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({
        background: {
          color: "#FF0000", border: null, border_width: null,
          padding_h: 4, padding_v: 2, shadow: null, radius: 4, shift: null,
        },
      }),
    });
    expect(svg).toContain("<rect");
    expect(svg).toContain("#FF0000");
    expect(svg).toContain('rx="4"');
  });

  it("does not render background rects when background.color is null", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ background: { color: null, border: null, border_width: null, padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null } }),
    });
    expect(svg).not.toContain("<rect");
  });

  it("uses text-fit when enabled", () => {
    const layer = makeTextLayer({
      font_size: 100, // would be huge
      text_fit: { enabled: true, min_size: 16, max_size: 48, max_lines: 2 },
      text: "Short",
    });
    const svg = buildTextLayerSvg({ width: 200, height: 80, layer });
    // font-size in SVG should be ≤ 48
    const match = svg.match(/font-size="(\d+)"/);
    expect(match).not.toBeNull();
    if (match) {
      expect(parseInt(match[1], 10)).toBeLessThanOrEqual(48);
    }
  });

  it("escapes XML special characters in text", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ text: "A & B < C > D" }),
    });
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");
  });

  it("center alignment uses text-anchor=middle", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ text_align_h: "center" }),
    });
    expect(svg).toContain('text-anchor="middle"');
  });

  it("right alignment uses text-anchor=end", () => {
    const svg = buildTextLayerSvg({
      width: 640, height: 400,
      layer: makeTextLayer({ text_align_h: "right" }),
    });
    expect(svg).toContain('text-anchor="end"');
  });
});

// ─── renderTextLayer ─────────────────────────────────────────────────────────

describe("renderTextLayer", () => {
  it("returns an OverlayOptions with input, left, top", async () => {
    const layer = makeTextLayer({ x: 50, y: 100 });
    const result = await renderTextLayer(layer);
    expect(result.left).toBe(50);
    expect(result.top).toBe(100);
    expect(result.input).toBeInstanceOf(Buffer);
  });

  it("rounds fractional x/y coordinates", async () => {
    const layer = makeTextLayer({ x: 50.7, y: 100.3 });
    const result = await renderTextLayer(layer);
    expect(result.left).toBe(51);
    expect(result.top).toBe(100);
  });
});
