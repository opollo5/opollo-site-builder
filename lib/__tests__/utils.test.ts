import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cn, formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// M15-6 #21 — lib/utils.ts unit tests.
//
// utils exports two helpers:
//   - cn: Tailwind class merger (clsx + tailwind-merge). Tested for
//     deduplication of conflicting utilities and conditional class inclusion.
//   - formatRelativeTime: converts an ISO timestamp to a human-readable
//     relative string. Boundary tested across all six output tiers:
//     null/undefined → "—", <5s → "just now", <60s → "Xs ago",
//     <3600s → "Xm ago", <86400s → "Xh ago", <30d → "Xd ago", ≥30d →
//     toLocaleDateString. Uses vi.setSystemTime so deltas are deterministic.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// cn
// ---------------------------------------------------------------------------

describe("cn", () => {
  it("returns an empty string for no arguments", () => {
    expect(cn()).toBe("");
  });

  it("returns a single class unchanged", () => {
    expect(cn("text-sm")).toBe("text-sm");
  });

  it("merges multiple classes", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("removes Tailwind conflicts — last wins", () => {
    // tailwind-merge deduplicates: px-4 should beat px-2
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional classes (falsy values are omitted)", () => {
    expect(cn("base", false && "falsy", undefined, null, "extra")).toBe(
      "base extra",
    );
  });

  it("handles object syntax from clsx", () => {
    expect(cn({ active: true, disabled: false })).toBe("active");
  });

  it("handles arrays of classes", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("deduplicates text-color conflicts", () => {
    expect(cn("text-red-500", "text-blue-600")).toBe("text-blue-600");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

  function agoMs(ms: number): string {
    return new Date(FIXED_NOW - ms).toISOString();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '—' for null", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(formatRelativeTime(undefined)).toBe("—");
  });

  it("returns '—' for an empty string", () => {
    expect(formatRelativeTime("")).toBe("—");
  });

  it("returns '—' for a non-date string", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("returns 'just now' for 0 seconds", () => {
    expect(formatRelativeTime(agoMs(0))).toBe("just now");
  });

  it("returns 'just now' for 4 seconds", () => {
    expect(formatRelativeTime(agoMs(4000))).toBe("just now");
  });

  it("returns 'just now' at the 5-second boundary (< 5 is 'just now', 5s = '5s ago')", () => {
    // diff = 4999ms → seconds = 4 → "just now"
    expect(formatRelativeTime(agoMs(4999))).toBe("just now");
    // diff = 5000ms → seconds = 5 → "5s ago"
    expect(formatRelativeTime(agoMs(5000))).toBe("5s ago");
  });

  it("returns '30s ago' for 30 seconds", () => {
    expect(formatRelativeTime(agoMs(30_000))).toBe("30s ago");
  });

  it("returns '59s ago' for 59 seconds", () => {
    expect(formatRelativeTime(agoMs(59_000))).toBe("59s ago");
  });

  it("returns '1m ago' for exactly 60 seconds", () => {
    expect(formatRelativeTime(agoMs(60_000))).toBe("1m ago");
  });

  it("returns '45m ago' for 45 minutes", () => {
    expect(formatRelativeTime(agoMs(45 * 60_000))).toBe("45m ago");
  });

  it("returns '59m ago' for 59 minutes", () => {
    expect(formatRelativeTime(agoMs(59 * 60_000))).toBe("59m ago");
  });

  it("returns '1h ago' for exactly 1 hour", () => {
    expect(formatRelativeTime(agoMs(60 * 60_000))).toBe("1h ago");
  });

  it("returns '12h ago' for 12 hours", () => {
    expect(formatRelativeTime(agoMs(12 * 3_600_000))).toBe("12h ago");
  });

  it("returns '23h ago' for 23 hours", () => {
    expect(formatRelativeTime(agoMs(23 * 3_600_000))).toBe("23h ago");
  });

  it("returns '1d ago' for exactly 24 hours", () => {
    expect(formatRelativeTime(agoMs(24 * 3_600_000))).toBe("1d ago");
  });

  it("returns '7d ago' for 7 days", () => {
    expect(formatRelativeTime(agoMs(7 * 86_400_000))).toBe("7d ago");
  });

  it("returns '29d ago' for 29 days", () => {
    expect(formatRelativeTime(agoMs(29 * 86_400_000))).toBe("29d ago");
  });

  it("returns a locale date string for timestamps >= 30 days ago", () => {
    const iso = agoMs(30 * 86_400_000);
    const result = formatRelativeTime(iso);
    // toLocaleDateString format varies by locale; just verify it's not a
    // relative-time format and is a non-empty string.
    expect(result).not.toMatch(/ago|now/);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles a future timestamp gracefully (diff is negative → clamped to 0 → 'just now')", () => {
    // agoMs(-5000) = 5s in the future
    expect(formatRelativeTime(agoMs(-5000))).toBe("just now");
  });
});
