import { describe, expect, it } from "vitest";

import { splitBulkPaste } from "@/lib/bulk-post-splitter";

// BL-5 — splitter unit matrix.

describe("splitBulkPaste", () => {
  it("returns [] on empty input", () => {
    expect(splitBulkPaste("")).toEqual([]);
    expect(splitBulkPaste("   \n\n  ")).toEqual([]);
  });

  it("returns one doc when no separator is present", () => {
    const text = "Just a single body of text. No separator.";
    const docs = splitBulkPaste(text);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.source).toBe(text);
    expect(docs[0]?.index).toBe(0);
  });

  it("splits on the explicit separator (mode-1)", () => {
    const text = ["First post body.", "", "---", "", "Second post body."].join(
      "\n",
    );
    const docs = splitBulkPaste(text);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.source).toBe("First post body.");
    expect(docs[1]?.source).toBe("Second post body.");
  });

  it("does not bisect on a `---` HR inside a single document", () => {
    // No blank lines around the `---`, so it's not a delimiter.
    const text = "Body line one\n---\nBody line two";
    const docs = splitBulkPaste(text);
    expect(docs).toHaveLength(1);
  });

  it("detects stacked YAML front-matter (mode-2)", () => {
    const text = [
      "---",
      "title: First",
      "---",
      "Body of first.",
      "---",
      "title: Second",
      "---",
      "Body of second.",
    ].join("\n");
    const docs = splitBulkPaste(text);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.source).toMatch(/title: First/);
    expect(docs[0]?.source).toMatch(/Body of first/);
    expect(docs[1]?.source).toMatch(/title: Second/);
    expect(docs[1]?.source).toMatch(/Body of second/);
  });

  it("falls back to mode-1 when stacked YAML detection finds only one block", () => {
    const text = [
      "---",
      "title: Only one",
      "---",
      "Body of the only post.",
    ].join("\n");
    const docs = splitBulkPaste(text);
    expect(docs).toHaveLength(1);
  });
});
