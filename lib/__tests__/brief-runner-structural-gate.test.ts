import { describe, expect, it } from "vitest";

import { runStructuralCompletenessCheck } from "@/lib/brief-runner";

// ---------------------------------------------------------------------------
// UAT smoke 1, 2026-04-28 — structural-completeness gate.
//
// Pure-function unit tests covering the gate added to catch
// max_tokens-truncated runner output. The gate runs unconditionally
// (not gated on designSystemVersion the way the strict suite is) so
// the no-active-DS bypass loophole that bit smoke 1 stays closed.
// ---------------------------------------------------------------------------

const FULL_DOC = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head>",
  "  <title>Page</title>",
  "  <style>body { color: black; }</style>",
  "</head>",
  "<body>",
  "  <h1>Heading</h1>",
  "  <p>Body copy.</p>",
  "</body>",
  "</html>",
].join("\n");

describe("runStructuralCompletenessCheck", () => {
  it("accepts a complete <!DOCTYPE html> document", () => {
    const result = runStructuralCompletenessCheck(FULL_DOC);
    expect(result.ok).toBe(true);
  });

  it("accepts a minimal one-liner full document", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head><body><p>x</p></body></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(true);
  });

  it("rejects HTML missing <!DOCTYPE html>", () => {
    const html =
      '<html><head><title>x</title></head><body><p>x</p></body></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_MISSING_DOCTYPE");
  });

  it("rejects HTML missing <html> open tag", () => {
    // Only DOCTYPE; no <html> at all. Earliest gate after DOCTYPE
    // hits the html-open check.
    const html =
      "<!DOCTYPE html><head><title>x</title></head><body><p>x</p></body>";
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_MISSING_HTML_OPEN");
  });

  it("rejects HTML missing </html>", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head><body><p>x</p></body>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_MISSING_HTML_CLOSE");
  });

  it("rejects HTML missing <body>", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_MISSING_BODY_OPEN");
  });

  it("rejects HTML missing </body>", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head><body><p>x</p></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_MISSING_BODY_CLOSE");
  });

  it("rejects unbalanced <style> / </style>", () => {
    // Single <style> open, no close — the exact UAT smoke 1 shape.
    const html =
      '<!DOCTYPE html><html><head><title>x</title><style>body { color: black; </head><body><p>x</p></body></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("MALFORMED_HTML_UNBALANCED_STYLE");
  });

  it("accepts HTML with zero <style> tags (balanced at 0)", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head><body><p>x</p></body></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(true);
  });

  it("accepts HTML with multiple balanced <style> blocks", () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title>' +
      "<style>body { margin: 0; }</style><style>p { color: red; }</style>" +
      "</head><body><p>x</p></body></html>";
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(true);
  });

  it("reproduces the UAT smoke 1 truncation shape", () => {
    // Real-world shape: DOCTYPE + <html> + <head> + <style> opens but
    // never closes, response cut off mid-CSS rule. Renderable as a
    // black-box iframe in the operator preview because the browser's
    // implicit-body recovery picks up the inline-style background.
    const truncated =
      '<!DOCTYPE html>\n<html lang="en" data-ds-version="">\n' +
      "<head>\n  <title>About Us</title>\n  <style>\n    body { background: #0a0e1a; color: #e8eaf6; }\n" +
      "    .s1231-services-grid {\n      display: grid;\n" +
      "      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));";
    const result = runStructuralCompletenessCheck(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // First failure surfaces at </html> — the truncation cuts everything
    // after the mid-CSS rule, so close-tag checks fail before the
    // unbalanced-style check.
    expect(result.code).toBe("MALFORMED_HTML_MISSING_HTML_CLOSE");
  });

  it("is case-insensitive on tag matching", () => {
    const html =
      "<!doctype HTML><HTML><HEAD><TITLE>X</TITLE></HEAD><BODY><P>X</P></BODY></HTML>";
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(true);
  });

  it("tolerates attributes on tag opens", () => {
    const html =
      '<!DOCTYPE html>' +
      '<html lang="en" data-ds-version="42">' +
      "<head><title>x</title></head>" +
      '<body class="page-1231 dark"><p>x</p></body></html>';
    const result = runStructuralCompletenessCheck(html);
    expect(result.ok).toBe(true);
  });
});
