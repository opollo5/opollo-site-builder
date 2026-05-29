import { describe, expect, test } from "vitest";

import { parseDocxHtml } from "@/lib/ingestion/docx-parse";

// ---------------------------------------------------------------------------
// C2 — DOCX parser unit tests.
//
// Drives parseDocxHtml directly with hand-crafted mammoth-shaped HTML so
// we can unit-test the parsing logic without round-tripping through a real
// .docx binary. parseDocxBuffer is a thin wrapper around mammoth +
// parseDocxHtml; the mammoth path is implicitly covered by integration tests
// once the official template fixture lands.
// ---------------------------------------------------------------------------

// 3-post happy path mirroring the brief's "three worked examples" shape.
const HAPPY_HTML = `
<h1>AI in marketing</h1>
<h2>Headline</h2>
<p>How AI changes marketing</p>
<h2>Body</h2>
<p>Long-form body paragraph one.</p>
<p>Body paragraph two.</p>
<h2>Platforms</h2>
<p>LinkedIn, Instagram</p>
<h2>Style</h2>
<p>clean_corporate</p>
<h2>Publish date</h2>
<p>2026-06-15</p>

<h1>Customer story</h1>
<h2>Headline</h2>
<p>From spreadsheets to streamlined</p>
<h2>Body</h2>
<p>Customer story body.</p>
<h2>Platforms</h2>
<p>linkedin</p>

<h1>Product update</h1>
<h2>Headline</h2>
<p>New feature ships today</p>
<h2>Body</h2>
<p>Description of the new feature.</p>
<h2>Platforms</h2>
<p>x, facebook</p>
<h2>Composition</h2>
<p>gradient_fade</p>
<h2>Notes</h2>
<p>Q2 announcement</p>
`;

describe("parseDocxHtml — happy path", () => {
  test("parses 3 posts with the full field set", () => {
    const result = parseDocxHtml(HAPPY_HTML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(3);
    expect(result.posts[0]).toEqual(
      expect.objectContaining({
        sourceRow: 1,
        post_topic: "AI in marketing",
        headline_text: "How AI changes marketing",
        target_platforms: ["linkedin", "instagram"],
        style_hint: "clean_corporate",
        publish_date: "2026-06-15",
      }),
    );
    // Body concatenates two paragraphs.
    expect(result.posts[0].body_text).toContain("paragraph one");
    expect(result.posts[0].body_text).toContain("paragraph two");

    expect(result.posts[2].target_platforms).toEqual(["x", "facebook"]);
    expect(result.posts[2].composition_hint).toBe("gradient_fade");
    expect(result.posts[2].notes).toBe("Q2 announcement");
  });

  test("required-only post passes; optional fields absent", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>Head</p>
      <h2>Body</h2><p>Body.</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].style_hint).toBeUndefined();
    expect(result.posts[0].publish_date).toBeUndefined();
  });
});

describe("parseDocxHtml — placeholder / hint filtering", () => {
  test("[bracketed] placeholders are stripped from body", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>Real headline</p>
      <h2>Body</h2>
      <p>[Replace this paragraph with your post body]</p>
      <p>Actual body content.</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].body_text).toBe("Actual body content.");
    expect(result.posts[0].body_text).not.toContain("[Replace");
  });

  test("whitespace-tolerant bracket detection", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>Headline</p>
      <h2>Body</h2>
      <p>   [   whitespace tolerant placeholder   ]   </p>
      <p>Real body.</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].body_text).toBe("Real body.");
  });

  test("placeholder filter strips entire required-field content → reject post", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>[placeholder]</p>
      <h2>Body</h2><p>Body</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Post 1.*Headline.*missing or empty/);
  });
});

describe("parseDocxHtml — unknown H2 handling", () => {
  test("unknown H2 logs warning and is ignored, parser still succeeds", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>Head</p>
      <h2>Random Heading</h2><p>Unrelated text</p>
      <h2>Body</h2><p>Body</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("Random Heading"))).toBe(true);
    expect(result.posts[0].body_text).toBe("Body");
  });
});

describe("parseDocxHtml — required-field rejection", () => {
  test("missing Body H2 in one post rejects with post number + topic", () => {
    const html = `
      <h1>First post</h1>
      <h2>Headline</h2><p>H1</p>
      <h2>Body</h2><p>B1</p>
      <h2>Platforms</h2><p>linkedin</p>

      <h1>Second post</h1>
      <h2>Headline</h2><p>H2</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Post 2.*Second post.*Body.*missing or empty/);
    expect(result.details?.postIndex).toBe(2);
  });

  test("missing Headline H2 rejects", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Headline.*missing or empty/);
  });

  test("missing Platforms H2 rejects", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Platforms.*missing or empty/);
  });
});

describe("parseDocxHtml — platform code handling", () => {
  test("lowercases + dedupes platform codes", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>LinkedIn, INSTAGRAM, linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].target_platforms).toEqual(["linkedin", "instagram"]);
  });

  test("unknown platform code rejects with post number", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin, tiktok</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Post 1.*platform code.*tiktok/);
    expect(result.details?.unknownValue).toBe("tiktok");
  });
});

describe("parseDocxHtml — date and enum validation", () => {
  test("malformed publish date rejects post", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin</p>
      <h2>Publish date</h2><p>not-a-date</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/publish date.*not YYYY-MM-DD/);
  });

  test("out-of-range month rejects", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin</p>
      <h2>Date</h2><p>2026-13-15</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a real calendar date/);
  });

  test("unknown style hint rejects", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin</p>
      <h2>Style</h2><p>extravagant</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/style hint.*extravagant/);
  });
});

describe("parseDocxHtml — robustness", () => {
  test("no H1 sections → reject", () => {
    const result = parseDocxHtml("<p>Just paragraphs.</p>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no H1 sections/);
  });

  test("inline tags (strong, em, a) are stripped, text preserved", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p><strong>Bold</strong> head with <em>italic</em></p>
      <h2>Body</h2><p>Visit <a href="http://x">this link</a> for details.</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].headline_text).toBe("Bold head with italic");
    expect(result.posts[0].body_text).toBe("Visit this link for details.");
  });

  test("HTML entities are decoded", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>R&amp;D update &amp; Q2</p>
      <h2>Body</h2><p>Body</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].headline_text).toBe("R&D update & Q2");
  });

  test("paragraphs before the first H1 are ignored, not assigned to post 1", () => {
    const html = `
      <p>Document title or intro</p>
      <p>More preamble</p>
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Body</h2><p>B</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].body_text).toBe("B");
    expect(result.posts[0].body_text).not.toContain("preamble");
  });

  test("paragraphs after an unknown H2 are bucketed nowhere (until next known H2)", () => {
    const html = `
      <h1>Topic</h1>
      <h2>Headline</h2><p>H</p>
      <h2>Mystery</h2>
      <p>This goes nowhere</p>
      <h2>Body</h2><p>Real body</p>
      <h2>Platforms</h2><p>linkedin</p>
    `;
    const result = parseDocxHtml(html);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].body_text).toBe("Real body");
    expect(result.posts[0].body_text).not.toContain("goes nowhere");
  });
});
