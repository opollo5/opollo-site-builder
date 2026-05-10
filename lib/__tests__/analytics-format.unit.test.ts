import { describe, expect, it } from "vitest";

import {
  deltaColorClass,
  formatDeltaPercent,
  formatEngagementRate,
  formatNumber,
} from "@/components/analytics/format";

// LAYER 1 — Unit. Pure formatter functions.

describe("BSP analytics — format helpers", () => {
  describe("formatNumber", () => {
    it("returns em-dash for null/undefined", () => {
      expect(formatNumber(null)).toBe("—");
      expect(formatNumber(undefined)).toBe("—");
    });

    it("renders small numbers as locale strings", () => {
      expect(formatNumber(42)).toBe("42");
      expect(formatNumber(999)).toBe("999");
    });

    it("abbreviates thousands with K", () => {
      expect(formatNumber(1500)).toBe("1.5K");
      expect(formatNumber(12_345)).toBe("12.3K");
    });

    it("abbreviates millions with M", () => {
      expect(formatNumber(2_510_000)).toBe("2.51M");
      expect(formatNumber(1_000_000)).toBe("1.00M");
    });

    it("handles negatives", () => {
      expect(formatNumber(-1500)).toBe("-1.5K");
    });
  });

  describe("formatDeltaPercent", () => {
    it("up-arrow for positive", () => {
      expect(formatDeltaPercent(25)).toBe("↑ 25.0%");
    });

    it("down-arrow for negative", () => {
      expect(formatDeltaPercent(-12.5)).toBe("↓ 12.5%");
    });

    it("em-dash for null", () => {
      expect(formatDeltaPercent(null)).toBe("—");
    });
  });

  describe("deltaColorClass", () => {
    it("emerald for positive", () => {
      expect(deltaColorClass(10)).toContain("emerald");
    });
    it("rose for negative", () => {
      expect(deltaColorClass(-10)).toContain("rose");
    });
    it("muted for zero / null", () => {
      expect(deltaColorClass(0)).toContain("muted");
      expect(deltaColorClass(null)).toContain("muted");
    });
  });

  describe("formatEngagementRate", () => {
    it("renders as percentage with 1 decimal", () => {
      expect(formatEngagementRate(0.156)).toBe("15.6%");
      expect(formatEngagementRate(0.05)).toBe("5.0%");
    });

    it("em-dash for null", () => {
      expect(formatEngagementRate(null)).toBe("—");
      expect(formatEngagementRate(undefined)).toBe("—");
    });
  });
});
