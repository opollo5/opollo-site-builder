import { describe, expect, it } from "vitest";

import {
  checkHtmlSize,
  estimateHtmlBytes,
  HTML_SIZE_MAX_BYTES,
} from "@/lib/html-size";

// ---------------------------------------------------------------------------
// M15-6 #21 — lib/html-size.ts unit tests.
//
// html-size exports the 500KB cap constant and two helpers:
//   - estimateHtmlBytes: returns string.length (JS-char count used as
//     a conservative byte estimate — non-ASCII chars are always larger
//     in UTF-8 than their JS string length, so the estimate is safe).
//   - checkHtmlSize: returns ok:true under cap, ok:false+HTML_TOO_LARGE
//     over cap. Both sides carry the cap constant so callers can format
//     human-readable messages without importing the constant separately.
//
// Tests cover: exact boundary (at cap = ok), one byte over (error),
// empty string, and a representative realistic HTML size.
// ---------------------------------------------------------------------------

const CAP = HTML_SIZE_MAX_BYTES; // 512 000

describe("HTML_SIZE_MAX_BYTES", () => {
  it("is 500 * 1024 bytes", () => {
    expect(HTML_SIZE_MAX_BYTES).toBe(500 * 1024);
  });
});

describe("estimateHtmlBytes", () => {
  it("returns 0 for an empty string", () => {
    expect(estimateHtmlBytes("")).toBe(0);
  });

  it("returns the string length for ASCII content", () => {
    const html = "<p>hello</p>";
    expect(estimateHtmlBytes(html)).toBe(html.length);
  });

  it("returns the character count (not UTF-8 byte count) for non-ASCII", () => {
    // '€' is 3 UTF-8 bytes but 1 JS character.
    // The function intentionally returns .length, which is 1 here.
    const html = "€";
    expect(estimateHtmlBytes(html)).toBe(1);
  });

  it("returns the correct length for a large string", () => {
    const large = "a".repeat(CAP);
    expect(estimateHtmlBytes(large)).toBe(CAP);
  });
});

describe("checkHtmlSize", () => {
  it("returns ok:true for an empty string", () => {
    const result = checkHtmlSize("");
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for a realistic 30KB page", () => {
    const html = "<section>".repeat(3000); // ~27KB
    expect(checkHtmlSize(html).ok).toBe(true);
  });

  it("returns ok:true when the string is exactly at the cap (boundary inclusive)", () => {
    const html = "a".repeat(CAP);
    const result = checkHtmlSize(html);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with HTML_TOO_LARGE when one byte over the cap", () => {
    const html = "a".repeat(CAP + 1);
    const result = checkHtmlSize(html);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("HTML_TOO_LARGE");
      expect(result.actual_bytes).toBe(CAP + 1);
      expect(result.cap_bytes).toBe(CAP);
    }
  });

  it("reports accurate actual_bytes and cap_bytes for a large overrun", () => {
    const overrun = CAP + 10_000;
    const html = "x".repeat(overrun);
    const result = checkHtmlSize(html);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.actual_bytes).toBe(overrun);
      expect(result.cap_bytes).toBe(CAP);
    }
  });

  it("cap_bytes matches the exported constant", () => {
    const html = "a".repeat(CAP + 1);
    const result = checkHtmlSize(html);
    if (!result.ok) {
      expect(result.cap_bytes).toBe(HTML_SIZE_MAX_BYTES);
    }
  });
});
