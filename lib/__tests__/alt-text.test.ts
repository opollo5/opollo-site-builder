import { describe, expect, it } from "vitest";

import { deriveAltText } from "@/lib/seo/alt-text";

describe("deriveAltText", () => {
  it("returns post title fallback when SEO title is empty", () => {
    expect(
      deriveAltText({
        seoTitle: "",
        siteName: "Acme",
        postTitleFallback: "Untitled post",
      }),
    ).toBe("Untitled post");
  });

  it("returns post title fallback when SEO title is null", () => {
    expect(
      deriveAltText({
        seoTitle: null,
        siteName: "Acme",
        postTitleFallback: "Untitled post",
      }),
    ).toBe("Untitled post");
  });

  it("strips trailing ' - {siteName}'", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know - Acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know");
  });

  it("strips trailing ' | {siteName}'", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know | Acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know");
  });

  it("strips trailing ' – {siteName}' (en dash)", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know – Acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know");
  });

  it("strips trailing ' — {siteName}' (em dash)", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know — Acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know");
  });

  it("returns SEO title untouched when no separator matches", () => {
    expect(
      deriveAltText({
        seoTitle: "Acme — best in class",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("Acme — best in class");
  });

  it("is case-sensitive (per spec)", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know - acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know - acme");
  });

  it("uses raw SEO title when site name is empty", () => {
    expect(
      deriveAltText({
        seoTitle: "5 things to know",
        siteName: "",
        postTitleFallback: "x",
      }),
    ).toBe("5 things to know");
  });

  it("does not strip if separator+site equals the entire title", () => {
    expect(
      deriveAltText({
        seoTitle: " - Acme",
        siteName: "Acme",
        postTitleFallback: "fallback",
      }),
      // After strip, would be empty → return original instead
    ).toBe(" - Acme");
  });

  it("trims whitespace around the stripped suffix", () => {
    expect(
      deriveAltText({
        seoTitle: "Title  -   Acme",
        siteName: "Acme",
        postTitleFallback: "x",
      }),
      // separator " - " with multiple spaces around — does not match,
      // falls through. Spec: separator format is exact.
    ).toBe("Title  -   Acme");
  });
});
