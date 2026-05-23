import { describe, expect, it } from "vitest";

// Inline the pure functions from ThemingClient to test without importing
// the client component (which would pull in React/Next.js client deps).

function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number | null {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theming WCAG contrast helpers", () => {
  it("black on white is 21:1", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).toBeCloseTo(21, 0);
  });

  it("white on white is 1:1", () => {
    const ratio = contrastRatio("#ffffff", "#ffffff");
    expect(ratio).toBeCloseTo(1, 1);
  });

  it("default success bg/fg passes WCAG AA (4.5:1)", () => {
    // #ECFDF5 success-bg vs #065F46 success-fg
    const ratio = contrastRatio("#ECFDF5", "#065F46");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("default warning bg/fg passes WCAG AA", () => {
    // #FFFBEB warning-bg vs #92400E warning-fg
    const ratio = contrastRatio("#FFFBEB", "#92400E");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("default danger bg/fg passes WCAG AA", () => {
    // #FEF2F2 danger-bg vs #991B1B danger-fg
    const ratio = contrastRatio("#FEF2F2", "#991B1B");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("returns null for invalid hex", () => {
    expect(contrastRatio("#GGGGGG", "#000000")).toBeNull();
    expect(contrastRatio("notahex", "#ffffff")).toBeNull();
    expect(contrastRatio("#123", "#ffffff")).toBeNull();
  });

  it("contrast is symmetric", () => {
    const r1 = contrastRatio("#ECFDF5", "#065F46");
    const r2 = contrastRatio("#065F46", "#ECFDF5");
    expect(r1).toBeCloseTo(r2!, 10);
  });
});

// ---------------------------------------------------------------------------
// buildThemeStyleBlock — from lib/platform/theming/get.ts
// ---------------------------------------------------------------------------

import { buildThemeStyleBlock } from "@/lib/platform/theming/get";
import type { ThemeOverrides } from "@/lib/platform/theming/types";

describe("buildThemeStyleBlock", () => {
  it("returns empty string for empty overrides", () => {
    expect(buildThemeStyleBlock({})).toBe("");
  });

  it("includes token in :root block", () => {
    const result = buildThemeStyleBlock({ "--primary": "hsl(142 76% 36%)" });
    expect(result).toContain(":root");
    expect(result).toContain("--primary: hsl(142 76% 36%);");
  });

  it("strips falsy values", () => {
    const overrides: ThemeOverrides = {
      "--primary": "red",
      "--color-success-bg": "",
    };
    const result = buildThemeStyleBlock(overrides);
    expect(result).toContain("--primary");
    expect(result).not.toContain("--color-success-bg");
  });

  it("includes multiple tokens", () => {
    const overrides: ThemeOverrides = {
      "--color-success-bg": "#ECFDF5",
      "--color-success-fg": "#065F46",
    };
    const result = buildThemeStyleBlock(overrides);
    expect(result).toContain("--color-success-bg: #ECFDF5;");
    expect(result).toContain("--color-success-fg: #065F46;");
  });
});
