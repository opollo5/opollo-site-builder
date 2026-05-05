import { describe, it, expect } from "vitest";
import { generateSlug, SLUG_STOP_WORDS } from "@/lib/slug";

describe("generateSlug", () => {
  it("basic kebab-cases a simple title", () => {
    expect(generateSlug("Hello World")).toBe("hello-world");
  });

  it("removes stop words", () => {
    expect(generateSlug("How to Build a Better Website")).toBe("build-better-website");
  });

  it("handles an all-stop-words title by keeping original words", () => {
    expect(generateSlug("the a an")).toBe("a");
  });

  it("strips diacritics", () => {
    expect(generateSlug("Café du Monde")).toBe("cafe-monde");
  });

  it("truncates at 60 chars without mid-word split", () => {
    const long = "a".repeat(20) + "-" + "b".repeat(20) + "-" + "c".repeat(30);
    const result = generateSlug(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).not.toMatch(/-$/);
  });

  it("collapses multiple hyphens", () => {
    expect(generateSlug("hello   ---   world")).toBe("hello-world");
  });

  it("preserves a slug that's already valid", () => {
    expect(generateSlug("seo-best-practices")).toBe("seo-best-practices");
  });

  it("handles numbers in titles", () => {
    expect(generateSlug("Top 10 Tips for 2024")).toBe("top-10-tips-2024");
  });
});

describe("SLUG_STOP_WORDS", () => {
  it("is a Set", () => {
    expect(SLUG_STOP_WORDS).toBeInstanceOf(Set);
  });

  it("contains common English stop words", () => {
    for (const w of ["the", "a", "an", "and", "or", "is", "are"]) {
      expect(SLUG_STOP_WORDS.has(w)).toBe(true);
    }
  });
});
