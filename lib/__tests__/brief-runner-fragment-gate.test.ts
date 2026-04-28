import { describe, expect, it } from "vitest";

import { runFragmentStructuralCheck } from "@/lib/brief-runner";

// ---------------------------------------------------------------------------
// PB-1 (2026-04-29) — runFragmentStructuralCheck matrix.
//
// Replaces runStructuralCompletenessCheck (PR #188, path-A) inside
// runGatesForBriefPage. The new gate validates path-B fragments:
//   - no host-WP chrome (DOCTYPE, html, head, body, nav, header, footer)
//   - no head-only or script tags (meta, link, title, script)
//   - at least one top-level <section data-opollo …>
//   - inline <style> content total ≤ 200 chars
// ---------------------------------------------------------------------------

const GOOD_FRAGMENT = `<section data-opollo class="ls-hero" data-ds-version="1">
  <h1>Hello</h1>
  <p>World.</p>
</section>`;

const GOOD_MULTI_SECTION = `<section data-opollo data-ds-version="1"><h1>Hero</h1></section>
<section data-opollo><p>Features.</p></section>
<section data-opollo><a href="/cta">CTA</a></section>`;

describe("runFragmentStructuralCheck — happy paths", () => {
  it("accepts a single-section fragment with the data-opollo marker", () => {
    expect(runFragmentStructuralCheck(GOOD_FRAGMENT)).toEqual({ ok: true });
  });

  it("accepts a multi-section fragment", () => {
    expect(runFragmentStructuralCheck(GOOD_MULTI_SECTION)).toEqual({
      ok: true,
    });
  });

  it("accepts inline <style> content under 200 chars (animation/utility allowance)", () => {
    const fragment = `<section data-opollo>
      <style>
        @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
      </style>
      <h1>Hi</h1>
    </section>`;
    expect(runFragmentStructuralCheck(fragment)).toEqual({ ok: true });
  });
});

describe("runFragmentStructuralCheck — empty / null", () => {
  it("rejects an empty string", () => {
    expect(runFragmentStructuralCheck("")).toMatchObject({
      ok: false,
      code: "FRAGMENT_EMPTY",
    });
  });

  it("rejects whitespace-only", () => {
    expect(runFragmentStructuralCheck("   \n\t ")).toMatchObject({
      ok: false,
      code: "FRAGMENT_EMPTY",
    });
  });
});

describe("runFragmentStructuralCheck — chrome-leak rejections", () => {
  const cases: Array<{ name: string; html: string; code: string }> = [
    {
      name: "DOCTYPE",
      html: `<!DOCTYPE html><section data-opollo></section>`,
      code: "FRAGMENT_DOCTYPE_LEAKED",
    },
    {
      name: "<html>",
      html: `<html><section data-opollo></section></html>`,
      code: "FRAGMENT_HTML_TAG_LEAKED",
    },
    {
      name: "<head>",
      html: `<head><title>x</title></head><section data-opollo></section>`,
      code: "FRAGMENT_HEAD_TAG_LEAKED",
    },
    {
      name: "<body>",
      html: `<body><section data-opollo></section></body>`,
      code: "FRAGMENT_BODY_TAG_LEAKED",
    },
    {
      name: "<nav>",
      html: `<nav><a>menu</a></nav><section data-opollo></section>`,
      code: "FRAGMENT_NAV_TAG_LEAKED",
    },
    {
      name: "<header>",
      html: `<header><h1>Site</h1></header><section data-opollo></section>`,
      code: "FRAGMENT_HEADER_TAG_LEAKED",
    },
    {
      name: "<footer>",
      html: `<section data-opollo></section><footer>©</footer>`,
      code: "FRAGMENT_FOOTER_TAG_LEAKED",
    },
    {
      name: "<meta>",
      html: `<meta name="description" content="x"><section data-opollo></section>`,
      code: "FRAGMENT_META_TAG_LEAKED",
    },
    {
      name: "<link>",
      html: `<link rel="stylesheet" href="/x.css"><section data-opollo></section>`,
      code: "FRAGMENT_LINK_TAG_LEAKED",
    },
    {
      name: "<title>",
      html: `<title>Page</title><section data-opollo></section>`,
      code: "FRAGMENT_TITLE_TAG_LEAKED",
    },
    {
      name: "<script>",
      html: `<script>alert(1)</script><section data-opollo></section>`,
      code: "FRAGMENT_SCRIPT_TAG_LEAKED",
    },
  ];
  for (const c of cases) {
    it(`rejects ${c.name}`, () => {
      expect(runFragmentStructuralCheck(c.html)).toMatchObject({
        ok: false,
        code: c.code,
      });
    });
  }
});

describe("runFragmentStructuralCheck — marker + style limits", () => {
  it("rejects a fragment without any data-opollo section", () => {
    const html = `<section><h1>missing marker</h1></section>`;
    expect(runFragmentStructuralCheck(html)).toMatchObject({
      ok: false,
      code: "FRAGMENT_MISSING_DATA_OPOLLO_SECTION",
    });
  });

  it("accepts a fragment where data-opollo appears alongside other attributes (any order)", () => {
    const html = `<section class="ls-hero" data-opollo data-ds-version="3"><h1>x</h1></section>`;
    expect(runFragmentStructuralCheck(html)).toEqual({ ok: true });
  });

  it("rejects a fragment whose inline <style> content exceeds 200 chars total", () => {
    const big = "a".repeat(250);
    const html = `<section data-opollo><style>.${big} { color: red; }</style></section>`;
    expect(runFragmentStructuralCheck(html)).toMatchObject({
      ok: false,
      code: "FRAGMENT_INLINE_STYLE_OVER_LIMIT",
    });
  });

  it("counts inline <style> content across multiple <style> blocks", () => {
    const block = "x".repeat(120); // 120 + 120 = 240 > 200
    const html = `<section data-opollo>
      <style>${block}</style>
      <style>${block}</style>
    </section>`;
    expect(runFragmentStructuralCheck(html)).toMatchObject({
      ok: false,
      code: "FRAGMENT_INLINE_STYLE_OVER_LIMIT",
    });
  });
});

describe("runFragmentStructuralCheck — case insensitivity", () => {
  it("rejects uppercase chrome tags", () => {
    expect(
      runFragmentStructuralCheck(`<HTML><section data-opollo></section></HTML>`),
    ).toMatchObject({
      ok: false,
      code: "FRAGMENT_HTML_TAG_LEAKED",
    });
  });

  it("accepts a section with mixed-case data-opollo (HTML attrs are case-insensitive)", () => {
    const html = `<SECTION DATA-OPOLLO><h1>x</h1></SECTION>`;
    expect(runFragmentStructuralCheck(html)).toEqual({ ok: true });
  });
});
