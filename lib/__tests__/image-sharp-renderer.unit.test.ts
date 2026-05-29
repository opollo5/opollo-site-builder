import { describe, it, expect } from "vitest";

import { autoFitFontSize, wrapText } from "@/lib/image/compositing/sharp-renderer";

// ---------------------------------------------------------------------------
// Unit tests for pure text-layout utilities in the sharp renderer.
// These don't require sharp, Supabase, or any I/O.
//
// Visual rendering tests (5 composited PNGs, one per aspect ratio) are
// exercised by the A-NEW-1 verification probe script run as part of the
// A-NEW-1 slice checkpoint. See scripts/probes/a-new-1-composite-verify.ts.
// ---------------------------------------------------------------------------

describe("wrapText", () => {
  it("short text fits on one line", () => {
    const lines = wrapText("Short text", 24, 300);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("Short text");
  });

  it("40-char input wraps at ~maxChars boundary", () => {
    // maxChars = floor(300 / (24 × 0.55)) ≈ 22 chars per line
    const text = "The quick brown fox jumps over the lazy dog";
    const lines = wrapText(text, 24, 300);
    expect(lines.length).toBeGreaterThan(1);
    // No line should exceed estimated character capacity significantly
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  it("80-char input wraps to multiple lines", () => {
    const text = "This is a much longer headline that should wrap to several lines when the font size is relatively large";
    const lines = wrapText(text, 36, 400);
    expect(lines.length).toBeGreaterThan(2);
  });

  it("single very long word is hard-broken", () => {
    const word = "supercalifragilisticexpialidocious";
    const lines = wrapText(word, 24, 200);
    // maxChars = floor(200 / (24×0.55)) ≈ 15
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it("returns [''] for empty input", () => {
    expect(wrapText("", 24, 300)).toEqual([""]);
  });
});

describe("autoFitFontSize", () => {
  it("returns a size ≤ maxFontSize", () => {
    const size = autoFitFontSize("Hello world", 300, 200, 72);
    expect(size).toBeLessThanOrEqual(72);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  it("10-char text in generous zone gets close to maxFontSize", () => {
    const size = autoFitFontSize("Short", 400, 300, 80);
    // 400px wide, maxChars ≈ floor(400/(0.55×size)) — should allow large font
    expect(size).toBeGreaterThanOrEqual(60);
  });

  it("80-char text in narrow zone gets small font", () => {
    const text = "This is a very long headline that needs to fit in a narrow column on the image";
    const size = autoFitFontSize(text, 200, 250, 48);
    // Should fit — font size will be reduced to make it work
    const lines = wrapText(text, size, 200);
    const totalH = lines.length * Math.round(size * 1.3);
    expect(totalH).toBeLessThanOrEqual(250);
  });

  it("returns at least 12 even for impossible constraints", () => {
    const size = autoFitFontSize("A very long headline", 50, 30, 72);
    expect(size).toBeGreaterThanOrEqual(12);
  });
});

// Note: TEMPLATES_V1 tests removed in A-NEW-4 — templates-v1.ts deleted,
// templates now live in image_templates DB table (A-NEW-2).
