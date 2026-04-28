import { describe, expect, it } from "vitest";

import { wrapForPreview } from "@/lib/preview-iframe-wrapper";

// ---------------------------------------------------------------------------
// PB-3 (2026-04-29) — preview-iframe wrapper unit tests.
//
// Two contracts pinned:
//   1. Path-A documents (have <!DOCTYPE> or <html opener) are passed
//      through unchanged. Legacy / evidence pages (e.g. dcbdf7d5...)
//      keep rendering exactly as they did before path B landed.
//   2. Path-B fragments are wrapped in a synthetic document that
//      includes the shim stylesheet so the iframe shows styled
//      content for visual review.
// ---------------------------------------------------------------------------

describe("wrapForPreview — empty / nullish input", () => {
  it("returns empty string for null", () => {
    expect(wrapForPreview(null)).toBe("");
  });
  it("returns empty string for undefined", () => {
    expect(wrapForPreview(undefined)).toBe("");
  });
  it("returns empty string for empty string", () => {
    expect(wrapForPreview("")).toBe("");
  });
  it("returns empty string for whitespace-only", () => {
    expect(wrapForPreview("   \n\t ")).toBe("");
  });
});

describe("wrapForPreview — path-A passthrough", () => {
  it("returns DOCTYPE-prefixed input unchanged", () => {
    const doc =
      '<!DOCTYPE html><html><head></head><body><p>x</p></body></html>';
    expect(wrapForPreview(doc)).toBe(doc);
  });
  it("returns <html>-opening input unchanged (no DOCTYPE)", () => {
    const doc = '<html lang="en"><body><p>x</p></body></html>';
    expect(wrapForPreview(doc)).toBe(doc);
  });
  it("is case-insensitive on the completeness markers", () => {
    const doc = '<!doctype HTML><HTML><BODY>x</BODY></HTML>';
    expect(wrapForPreview(doc)).toBe(doc);
  });
});

describe("wrapForPreview — path-B fragment wrapping", () => {
  const FRAGMENT = '<section data-opollo class="ls-hero"><h1>Hi</h1></section>';

  it("wraps a fragment in a synthetic <!DOCTYPE>...</html> shell", () => {
    const out = wrapForPreview(FRAGMENT);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain('<html lang="en">');
    expect(out).toContain('<meta charset="UTF-8">');
    expect(out).toContain('<meta name="viewport"');
    expect(out).toContain("<style>");
    expect(out).toContain("</style>");
    expect(out).toContain("<body>");
    expect(out).toContain(FRAGMENT);
    expect(out).toContain("</body>");
    expect(out.endsWith("</html>")).toBe(true);
  });

  it("includes the shim stylesheet body { ... } rule", () => {
    const out = wrapForPreview(FRAGMENT);
    expect(out).toContain("body {");
    expect(out).toContain("font-family:");
  });

  it("includes scoped [data-opollo] rules", () => {
    const out = wrapForPreview(FRAGMENT);
    expect(out).toContain("[data-opollo]");
    expect(out).toContain("--ds-color-primary");
  });

  it("preserves the fragment's exact bytes within the wrapper body", () => {
    const out = wrapForPreview(FRAGMENT);
    // Confirm the fragment appears verbatim, not escaped or transformed.
    expect(out).toContain(FRAGMENT);
  });

  it("wraps a multi-section fragment", () => {
    const multi =
      '<section data-opollo><h1>Hero</h1></section>\n<section data-opollo><p>Features.</p></section>';
    const out = wrapForPreview(multi);
    expect(out).toContain(multi);
    expect(out).toContain("<style>");
  });

  it("wraps a bare fragment lacking data-opollo (defensive)", () => {
    // The runner gate prevents this in production, but the wrapper
    // shouldn't crash on unmarked content — it just renders it
    // unstyled (CSS is scoped to [data-opollo]).
    const out = wrapForPreview("<section><h1>Bare</h1></section>");
    expect(out).toContain("<section><h1>Bare</h1></section>");
    expect(out).toContain("<style>");
  });
});
