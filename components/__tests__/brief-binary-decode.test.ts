import { describe, expect, it } from "vitest";

import { decodePdf, decodeDocx } from "@/lib/brief-binary-decode";

// ---------------------------------------------------------------------------
// brief-binary-decode unit tests
//
// Both functions accept an optional _extractor parameter for DI. Tests
// inject mock extractors so no real PDF/DOCX parsing runs and no native
// modules need vi.mock hoisting.
// ---------------------------------------------------------------------------

describe("decodePdf", () => {
  it("returns extracted text on success", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const result = await decodePdf(bytes, async () => "Page 1 Some content.");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Page 1 Some content.");
  });

  it("returns BRIEF_PARSE_FAILED when extracted text is blank (scanned PDF)", async () => {
    const result = await decodePdf(new Uint8Array(4), async () => "   ");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BRIEF_PARSE_FAILED");
      expect(result.detail).toMatch(/scanned/i);
    }
  });

  it("returns BRIEF_PARSE_FAILED when extractor throws", async () => {
    const result = await decodePdf(
      new Uint8Array(4),
      async () => { throw new Error("bad pdf"); },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BRIEF_PARSE_FAILED");
      expect(result.detail).toMatch(/extraction failed/i);
    }
  });
});

describe("decodeDocx", () => {
  it("returns extracted text on success", async () => {
    const result = await decodeDocx(new Uint8Array(8), async () => "Heading Body copy.");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Heading Body copy.");
  });

  it("returns BRIEF_PARSE_FAILED when extracted text is blank (images-only docx)", async () => {
    const result = await decodeDocx(new Uint8Array(4), async () => " ");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BRIEF_PARSE_FAILED");
      expect(result.detail).toMatch(/empty/i);
    }
  });

  it("returns BRIEF_PARSE_FAILED when extractor throws", async () => {
    const result = await decodeDocx(
      new Uint8Array(4),
      async () => { throw new Error("bad zip"); },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BRIEF_PARSE_FAILED");
      expect(result.detail).toMatch(/extraction failed/i);
    }
  });
});
