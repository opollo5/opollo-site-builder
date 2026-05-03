import { describe, expect, it } from "vitest";

import { TEXT_ZONE_MAP } from "@/lib/image/compositing/text-zones";
import type { CompositionType } from "@/lib/image/types";

// Unit tests for the text-zone map and pixel coordinate conversion.
// The conversion logic is inline in bannerbear.ts; we test the TEXT_ZONE_MAP
// contract here so a future maintainer can't shift coordinates without
// breaking these assertions.

function toPixels(
  zonePercent: { x: number; y: number; width: number; height: number },
  imgWidth: number,
  imgHeight: number,
) {
  return {
    x: Math.round((zonePercent.x / 100) * imgWidth),
    y: Math.round((zonePercent.y / 100) * imgHeight),
    w: Math.round((zonePercent.width / 100) * imgWidth),
    h: Math.round((zonePercent.height / 100) * imgHeight),
  };
}

describe("TEXT_ZONE_MAP", () => {
  it("all composition types are defined", () => {
    const types: CompositionType[] = [
      "split_layout",
      "gradient_fade",
      "full_background",
      "geometric",
      "texture",
    ];
    for (const t of types) {
      expect(TEXT_ZONE_MAP[t], `${t} should be defined`).toBeDefined();
    }
  });

  it("all zone values are valid percents (0–100)", () => {
    for (const [type, zone] of Object.entries(TEXT_ZONE_MAP)) {
      expect(zone.x, `${type}.x`).toBeGreaterThanOrEqual(0);
      expect(zone.y, `${type}.y`).toBeGreaterThanOrEqual(0);
      expect(zone.width, `${type}.width`).toBeGreaterThan(0);
      expect(zone.height, `${type}.height`).toBeGreaterThan(0);
      expect(zone.x + zone.width, `${type} x+width`).toBeLessThanOrEqual(100);
      expect(zone.y + zone.height, `${type} y+height`).toBeLessThanOrEqual(100);
    }
  });

  it("split_layout text zone is on the right side", () => {
    const zone = TEXT_ZONE_MAP.split_layout;
    // Right side: x > 50%
    expect(zone.x).toBeGreaterThan(50);
  });

  it("gradient_fade text zone is on the left side", () => {
    const zone = TEXT_ZONE_MAP.gradient_fade;
    expect(zone.x).toBeLessThan(20);
    expect(zone.x + zone.width).toBeLessThan(60);
  });

  it("full_background text zone is in the lower third", () => {
    const zone = TEXT_ZONE_MAP.full_background;
    expect(zone.y).toBeGreaterThan(60);
  });
});

describe("pixel conversion for 1080×1080 frame", () => {
  it("split_layout produces expected pixel bounds", () => {
    const px = toPixels(TEXT_ZONE_MAP.split_layout, 1080, 1080);
    // x should be ~626px (58% of 1080)
    expect(px.x).toBe(Math.round(0.58 * 1080));
    // width should be ~400px (37% of 1080)
    expect(px.w).toBe(Math.round(0.37 * 1080));
    // Text zone must not overflow the frame
    expect(px.x + px.w).toBeLessThanOrEqual(1080);
  });

  it("full_background zone starts in the lower third for 1920×1080", () => {
    const px = toPixels(TEXT_ZONE_MAP.full_background, 1920, 1080);
    // y should be ~734px (68% of 1080)
    expect(px.y).toBeGreaterThan(650);
    expect(px.w).toBeGreaterThan(1600); // 90% of 1920
  });
});
