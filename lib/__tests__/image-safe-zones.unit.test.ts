/**
 * Slice H — Safe-zone keep-clear injection (D11, D29, D30)
 *
 * Tests:
 *  - Safe-zone derivation from TextZone coordinates → GridRegion (D29)
 *  - 3×3 grid mapping correct for all 9 cells (D29)
 *  - Prompt fragment matches D30 exact format
 *  - buildPrompt includes fragment when provided
 *  - buildPrompt unchanged when no fragment (images without templates unaffected)
 *  - buildSafeZoneFragment returns "" for empty regions (no constraint)
 */

import { describe, it, expect } from "vitest";
import {
  coordToGridRegion,
  textZonesToGridRegions,
  buildSafeZoneFragment,
  type GridRegion,
} from "@/lib/image/generator/safe-zones";
import { buildPrompt } from "@/lib/image/generator/prompt-engine";
import type { TextZone } from "@/lib/image/compositing/text-zones";

// ─── D29: 3×3 grid mapping ────────────────────────────────────────────────────

describe("coordToGridRegion — D29 3×3 grid", () => {
  // Each third of each axis maps to the correct label.
  const cases: [number, number, GridRegion][] = [
    [0.1, 0.1, "top-left"],
    [0.5, 0.1, "top-center"],
    [0.9, 0.1, "top-right"],
    [0.1, 0.5, "mid-left"],
    [0.5, 0.5, "center"],
    [0.9, 0.5, "mid-right"],
    [0.1, 0.9, "bottom-left"],
    [0.5, 0.9, "bottom-center"],
    [0.9, 0.9, "bottom-right"],
  ];

  it.each(cases)("coord (%s, %s) → '%s'", (x, y, expected) => {
    expect(coordToGridRegion(x, y)).toBe(expected);
  });

  it("boundary at exactly 1/3 maps to center column", () => {
    expect(coordToGridRegion(1 / 3, 0.5)).toBe("center");
  });

  it("boundary at exactly 2/3 maps to right column", () => {
    expect(coordToGridRegion(2 / 3, 0.5)).toBe("mid-right");
  });
});

// ─── textZonesToGridRegions ────────────────────────────────────────────────────

describe("textZonesToGridRegions", () => {
  it("converts TEXT_ZONE_MAP split_layout zone to the correct region", () => {
    // split_layout: x:58, y:15, w:37, h:70 → center = (58+18.5)/100, (15+35)/100 = (0.765, 0.50)
    // → right column, mid row → "mid-right"
    const zone: TextZone = { x: 58, y: 15, width: 37, height: 70, alignment: "left" };
    const regions = textZonesToGridRegions([zone]);
    expect(regions).toEqual(["mid-right"]);
  });

  it("full_background zone: center near bottom → bottom-center", () => {
    // full_background: x:5, y:68, w:90, h:24 → center = (5+45)/100, (68+12)/100 = (0.50, 0.80)
    // → center column, bottom row → "bottom-center"
    const zone: TextZone = { x: 5, y: 68, width: 90, height: 24, alignment: "center" };
    const regions = textZonesToGridRegions([zone]);
    expect(regions).toEqual(["bottom-center"]);
  });

  it("deduplicates regions from multiple zones in same cell", () => {
    const zone1: TextZone = { x: 5, y: 5, width: 10, height: 10, alignment: "left" };
    const zone2: TextZone = { x: 8, y: 8, width: 5, height: 5, alignment: "left" };
    // Both centres in top-left cell
    const regions = textZonesToGridRegions([zone1, zone2]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toBe("top-left");
  });
});

// ─── D30: exact prompt fragment format ───────────────────────────────────────

describe("buildSafeZoneFragment — D30 exact format", () => {
  it("single region: exact D30 format", () => {
    const result = buildSafeZoneFragment(["mid-right"]);
    expect(result).toBe(
      "Composition constraints: keep the mid-right area(s) visually simple and low-detail for overlaid text and logo. Do not place faces, hands, product hero elements, or fine details there."
    );
  });

  it("multiple regions: comma-joined in the fragment", () => {
    const result = buildSafeZoneFragment(["top-left", "bottom-center"]);
    expect(result).toContain("top-left, bottom-center");
    expect(result).toMatch(/^Composition constraints:/);
  });

  it("empty regions: returns empty string (no constraint injected)", () => {
    expect(buildSafeZoneFragment([])).toBe("");
  });
});

// ─── buildPrompt integration ──────────────────────────────────────────────────

describe("buildPrompt — safe-zone fragment injection", () => {
  const BASE = {
    styleId: "clean_corporate" as const,
    primaryColour: "#1a56db",
    compositionType: "split_layout" as const,
  };

  it("includes the keep-clear fragment when provided", () => {
    const fragment = buildSafeZoneFragment(["mid-right"]);
    const prompt = buildPrompt({ ...BASE, keepClearFragment: fragment });
    expect(prompt).toContain("Composition constraints:");
    expect(prompt).toContain("mid-right");
  });

  it("prompt unchanged when keepClearFragment is absent (images without templates)", () => {
    const withoutFragment = buildPrompt(BASE);
    const withEmptyFragment = buildPrompt({ ...BASE, keepClearFragment: "" });
    expect(withoutFragment).toBe(withEmptyFragment);
    expect(withoutFragment).not.toContain("Composition constraints:");
  });

  it("fragment placed before negative suffix (no text, no words…)", () => {
    const fragment = buildSafeZoneFragment(["bottom-center"]);
    const prompt = buildPrompt({ ...BASE, keepClearFragment: fragment });
    const fragmentIdx = prompt.indexOf("Composition constraints:");
    const negativeIdx = prompt.indexOf("no text");
    expect(fragmentIdx).toBeGreaterThan(-1);
    expect(fragmentIdx).toBeLessThan(negativeIdx);
  });
});
