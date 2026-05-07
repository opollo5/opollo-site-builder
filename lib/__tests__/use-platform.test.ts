import { describe, expect, it } from "vitest";

import { detectPlatform } from "@/lib/hooks/use-platform";

describe("detectPlatform", () => {
  it("identifies macOS via navigator.platform", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh)", "MacIntel")).toBe("mac");
  });

  it("identifies macOS via UA fallback (modern Safari hides platform)", () => {
    // Modern Safari may report empty navigator.platform.
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari", "")).toBe("mac");
  });

  it("identifies Windows via navigator.platform", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0)", "Win32")).toBe("windows");
  });

  it("identifies Windows via UA when platform is empty", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0)", "")).toBe("windows");
  });

  it("identifies Linux", () => {
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)", "Linux x86_64")).toBe("linux");
  });

  it("falls back to 'unknown' for empty inputs", () => {
    expect(detectPlatform("", "")).toBe("unknown");
  });

  it("falls back to 'unknown' for unrecognised UA", () => {
    expect(detectPlatform("Mozilla/5.0 (PlayStation 5)", "PS5")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(detectPlatform("MOZILLA/5.0 (MACINTOSH)", "MACINTEL")).toBe("mac");
  });
});
