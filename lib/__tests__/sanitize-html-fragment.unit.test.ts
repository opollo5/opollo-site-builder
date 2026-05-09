import { describe, expect, it } from "vitest";

import { sanitizeHtmlFragment } from "@/lib/sanitize-html-fragment";
import { XSS_PAYLOADS } from "@/tests/helpers/xss-payloads";

// ---------------------------------------------------------------------------
// LAYER 1 — Unit tests for the AI-output HTML sanitiser.
//
// Drives every XSS payload from the shared list through the
// sanitiser and asserts the output contains no tags or attributes
// that would create an active execution path.
//
// Companion component test under components/__tests__/ asserts the
// sanitised output rendered into the DOM has no event handlers.
// ---------------------------------------------------------------------------

describe("sanitizeHtmlFragment — block list", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeHtmlFragment("")).toBe("");
  });

  it("preserves an allowed structural fragment", () => {
    const safe = '<button class="primary">Click me</button>';
    expect(sanitizeHtmlFragment(safe)).toBe(safe);
  });

  it("preserves an input + label combo", () => {
    const safe = '<label for="x">Email</label><input type="email" id="x" />';
    expect(sanitizeHtmlFragment(safe)).toBe(safe);
  });

  it("is idempotent", () => {
    const safe = '<div><p>hello</p><button>OK</button></div>';
    expect(sanitizeHtmlFragment(sanitizeHtmlFragment(safe))).toBe(
      sanitizeHtmlFragment(safe),
    );
  });
});

describe.each(XSS_PAYLOADS)(
  "sanitizeHtmlFragment — XSS payload (%s)",
  ({ payload, technique }) => {
    it(`blocks: ${technique}`, () => {
      const out = sanitizeHtmlFragment(payload);
      // Hard invariants — these MUST hold for every XSS payload.
      expect(out).not.toMatch(/<script\b/i);
      expect(out).not.toMatch(/<iframe\b/i);
      expect(out).not.toMatch(/\son\w+\s*=/i); // onload, onerror, ontoggle, ...

      // When the dangerous scheme appears INSIDE an attribute value
      // (href/src), it must be stripped. Bare `javascript:alert(1)`
      // text-only payloads are NOT a vulnerability when rendered via
      // innerHTML — browsers do not execute text nodes — so we only
      // assert the dangerous attribute path here.
      expect(out).not.toMatch(/\s(href|src)\s*=\s*["']?javascript:/i);
      expect(out).not.toMatch(/\s(href|src)\s*=\s*["']?vbscript:/i);
      expect(out).not.toMatch(/\s(href|src)\s*=\s*["']?data:[^"'>]*script/i);
    });
  },
);

describe("sanitizeHtmlFragment — fixed-point stabilisation", () => {
  // Pinned by CodeQL "incomplete multi-character sanitization" finding.
  // Single-pass strips would leave residue tags after one round of
  // sanitisation. The loop runs to stabilisation; if a future refactor
  // removes the loop, these tests fire red.

  it("collapses nested <scr<script>ipt> into a single safe pass", () => {
    const malicious = "<scr<script>ipt>alert(1)</scr</script>ipt>";
    const out = sanitizeHtmlFragment(malicious);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(1)");
  });

  it("collapses doubly-nested <<script>script> patterns", () => {
    const malicious = "<<script>script>alert(1)<</script>/script>";
    const out = sanitizeHtmlFragment(malicious);
    expect(out).not.toMatch(/<script/i);
  });

  it("collapses nested iframe inside a script wrapper", () => {
    const malicious = "<script><iframe src=x></iframe></script>";
    const out = sanitizeHtmlFragment(malicious);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<iframe/i);
  });
});

describe("sanitizeHtmlFragment — defensive cases", () => {
  it("strips event handler from an otherwise allowed tag", () => {
    const malicious = '<button onclick="alert(1)">Click</button>';
    const out = sanitizeHtmlFragment(malicious);
    expect(out).toMatch(/<button/i);
    expect(out).not.toMatch(/\sonclick/i);
  });

  it("strips javascript: href from an anchor", () => {
    const malicious = '<a href="javascript:alert(1)">link</a>';
    const out = sanitizeHtmlFragment(malicious);
    expect(out).toMatch(/<a\b/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("strips a script tag with content", () => {
    const malicious = '<p>before</p><script>alert(1)</script><p>after</p>';
    const out = sanitizeHtmlFragment(malicious);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(1\)/);
    expect(out).toMatch(/before/);
    expect(out).toMatch(/after/);
  });

  it("strips a style tag with content (CSS-import attack vector)", () => {
    const malicious = "<style>@import 'javascript:alert(1)';</style><p>x</p>";
    const out = sanitizeHtmlFragment(malicious);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toMatch(/<p>x<\/p>/);
  });
});
