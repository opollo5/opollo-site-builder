import { describe, expect, it } from "vitest";

import {
  composeImageEmbeddingInput,
  vectorToLiteral,
} from "@/lib/images/embed";

// ---------------------------------------------------------------------------
// Spec 05 — pure-function tests for the embed module.
//
// Network-side helpers (`embedText`, `embedImageCaption`,
// `embedAndStoreImage`, `refreshImageEmbedding`) are exercised at the
// integration layer in PR B's tests. This file covers the deterministic
// shape-only helpers.
// ---------------------------------------------------------------------------

describe("composeImageEmbeddingInput", () => {
  it("concatenates title, caption, alt, tags, filename in priority order", () => {
    const input = composeImageEmbeddingInput({
      title: "Sunset over Sydney",
      caption: "A wide shot of Sydney Harbour at sunset.",
      alt: "Sydney harbour, golden hour",
      tags: ["sunset", "sydney", "harbour"],
      filename: "istock-12345.jpg",
    });
    expect(input).not.toBeNull();
    expect(input).toContain("Sunset over Sydney");
    expect(input).toContain("Sydney Harbour at sunset");
    expect(input).toContain("sunset, sydney, harbour");
    expect(input).toContain("istock-12345.jpg");
    // Title should appear before filename in the composed string.
    expect(input!.indexOf("Sunset over Sydney")).toBeLessThan(
      input!.indexOf("istock-12345.jpg"),
    );
  });

  it("returns null when every field is empty / null", () => {
    expect(
      composeImageEmbeddingInput({
        title: null,
        caption: null,
        alt: null,
        tags: null,
        filename: null,
      }),
    ).toBeNull();
    expect(
      composeImageEmbeddingInput({
        title: "",
        caption: "  ",
        alt: "\t",
        tags: [],
        filename: "",
      }),
    ).toBeNull();
  });

  it("trims whitespace and collapses runs of whitespace", () => {
    const input = composeImageEmbeddingInput({
      caption: "   spaced    out   caption   ",
      filename: "  file.jpg  ",
    });
    expect(input).toBe("spaced out caption. file.jpg");
  });

  it("drops empty tags before joining", () => {
    const input = composeImageEmbeddingInput({
      caption: "x",
      tags: ["one", "", "  ", "two"],
    });
    expect(input).toContain("Tags: one, two");
  });

  it("caps very long inputs at the documented MAX_INPUT_CHARS", () => {
    const huge = "a".repeat(50_000);
    const input = composeImageEmbeddingInput({ caption: huge });
    expect(input).not.toBeNull();
    expect(input!.length).toBeLessThanOrEqual(24_000);
  });
});

describe("vectorToLiteral", () => {
  it("formats a float array as a pgvector literal", () => {
    expect(vectorToLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("handles negatives + zeros", () => {
    expect(vectorToLiteral([-1, 0, 1])).toBe("[-1,0,1]");
  });

  it("formats an empty vector as []", () => {
    expect(vectorToLiteral([])).toBe("[]");
  });
});
