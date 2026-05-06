import { describe, expect, it } from "vitest";

import { LEADSOURCE_FONT_LOAD_HTML } from "@/lib/leadsource-fonts";

// ---------------------------------------------------------------------------
// M15-6 #21 — lib/leadsource-fonts.ts unit tests.
//
// LEADSOURCE_FONT_LOAD_HTML is a constant prepended to every LeadSource
// published page to load the three spec fonts (Inter, Inter Tight, JetBrains
// Mono). The spec is locked to seed/leadsource/source/v2-stripe.html:7-9.
//
// Tests verify that the constant:
//   - Contains the required Google Fonts preconnect hints.
//   - References all three font families at the locked weights.
//   - Uses display=swap for performance.
//
// If the font families or weights drift from the spec, these tests will fail
// before the change reaches production — where it would silently switch the
// entire LeadSource fleet to system fallback fonts.
// ---------------------------------------------------------------------------

describe("LEADSOURCE_FONT_LOAD_HTML", () => {
  it("is a non-empty string", () => {
    expect(typeof LEADSOURCE_FONT_LOAD_HTML).toBe("string");
    expect(LEADSOURCE_FONT_LOAD_HTML.length).toBeGreaterThan(0);
  });

  it("includes a preconnect hint to fonts.googleapis.com", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain(
      'rel="preconnect" href="https://fonts.googleapis.com"',
    );
  });

  it("includes a crossorigin preconnect hint to fonts.gstatic.com", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain(
      'href="https://fonts.gstatic.com" crossorigin',
    );
  });

  it("loads Inter at the spec weights (400;500;600)", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain("Inter:wght@400;500;600");
  });

  it("loads Inter Tight at the spec weights (500;600)", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain("Inter+Tight:wght@500;600");
  });

  it("loads JetBrains Mono at the spec weights (400;500)", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain(
      "JetBrains+Mono:wght@400;500",
    );
  });

  it("uses display=swap for performance", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain("display=swap");
  });

  it("is a stylesheet link (not a style tag)", () => {
    expect(LEADSOURCE_FONT_LOAD_HTML).toContain('rel="stylesheet"');
  });
});
