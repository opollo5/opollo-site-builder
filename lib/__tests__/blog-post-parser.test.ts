import { describe, expect, it } from "vitest";

import {
  parseBlogPostMetadata,
  slugify,
} from "@/lib/blog-post-parser";

// BP-1 — Smart-parser unit matrix. Pure logic — no DB, no network.
// The vitest setup runs against Supabase but this file doesn't touch it.

describe("slugify", () => {
  it("kebab-cases lowercase ASCII", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Society")).toBe("cafe-society");
  });

  it("collapses whitespace and punctuation", () => {
    expect(slugify("  Many   spaces!! and??? punc  ")).toBe(
      "many-spaces-and-punc",
    );
  });

  it("caps at 60 chars without trailing dash", () => {
    const long =
      "this title is intentionally and excessively long so we trim it and the result should clip cleanly";
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith("-")).toBe(false);
  });

  it("returns empty string when no slug-able chars", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("parseBlogPostMetadata — YAML front-matter", () => {
  it("extracts every field from a complete front-matter block", () => {
    const text = `---
title: My Post Title
slug: my-post-title
meta_title: SEO Title
meta_description: A concise description for SERPs.
---

Body paragraph here.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("My Post Title");
    expect(result.slug).toBe("my-post-title");
    expect(result.meta_title).toBe("SEO Title");
    expect(result.meta_description).toBe("A concise description for SERPs.");
    expect(result.source_map).toEqual({
      title: "yaml",
      slug: "yaml",
      meta_title: "yaml",
      meta_description: "yaml",
    });
  });

  it("strips matched quotes around YAML values", () => {
    const text = `---
title: "Quoted Title"
slug: 'quoted-slug'
---

Body.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("Quoted Title");
    expect(result.slug).toBe("quoted-slug");
  });

  it("YAML title alone derives slug + meta_title", () => {
    const text = `---
title: Only Title
---

Body.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("Only Title");
    expect(result.slug).toBe("only-title");
    expect(result.source_map.slug).toBe("derived");
    expect(result.meta_title).toBe("Only Title");
    expect(result.source_map.meta_title).toBe("derived");
  });
});

describe("parseBlogPostMetadata — inline labels", () => {
  it("extracts inline labels at the top", () => {
    const text = `Title: Inline Title
Slug: inline-slug
Meta description: Inline desc.

Body paragraph.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("Inline Title");
    expect(result.slug).toBe("inline-slug");
    expect(result.meta_description).toBe("Inline desc.");
    expect(result.source_map.title).toBe("inline");
    expect(result.source_map.meta_description).toBe("inline");
  });

  it("accepts case-insensitive labels with spaces", () => {
    const text = `TITLE: Caps Title
SEO Description: From SEO label.

Body.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("Caps Title");
    expect(result.meta_description).toBe("From SEO label.");
  });

  it("stops scanning labels at the first non-label line", () => {
    const text = `Title: First Title
Some prose here.
Slug: should-not-parse

Body.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("First Title");
    // "Slug:" appears after a non-label line so should not be picked up
    // as inline; falls back to derived from title.
    expect(result.source_map.slug).toBe("derived");
  });
});

describe("parseBlogPostMetadata — HTML meta tags", () => {
  it("extracts <title> and <meta name=description>", () => {
    const text = `<title>HTML Title</title>
<meta name="description" content="HTML description.">

<p>Body.</p>`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("HTML Title");
    expect(result.meta_description).toBe("HTML description.");
    expect(result.source_map.title).toBe("html");
    expect(result.source_map.meta_description).toBe("html");
  });

  it("extracts canonical URL → slug from last path segment", () => {
    const text = `<title>Canon</title>
<link rel="canonical" href="https://example.com/blog/great-slug">`;
    const result = parseBlogPostMetadata(text);
    expect(result.slug).toBe("great-slug");
    expect(result.source_map.slug).toBe("html");
  });

  it("decodes HTML entities in meta values", () => {
    const text = `<title>Foo &amp; Bar</title>`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("Foo & Bar");
  });
});

describe("parseBlogPostMetadata — H1 fallback", () => {
  it("falls back to first markdown H1", () => {
    const text = `# H1 Title

Body paragraph.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("H1 Title");
    expect(result.source_map.title).toBe("h1");
  });

  it("falls back to first <h1> when no markdown H1", () => {
    const text = `<h1>HTML H1 Title</h1>
<p>Body.</p>`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("HTML H1 Title");
    expect(result.source_map.title).toBe("h1");
  });
});

describe("parseBlogPostMetadata — first paragraph fallback", () => {
  it("falls back to first non-heading paragraph for meta_description", () => {
    const text = `# Title

The first body paragraph that should become meta description.

Second paragraph that should not.`;
    const result = parseBlogPostMetadata(text);
    expect(result.meta_description).toBe(
      "The first body paragraph that should become meta description.",
    );
    expect(result.source_map.meta_description).toBe("first_paragraph");
  });

  it("truncates long first paragraphs at the 160-char cap on a word boundary", () => {
    const long = "Word ".repeat(60).trim(); // ~300 chars
    const text = `# Title\n\n${long}`;
    const result = parseBlogPostMetadata(text);
    expect(result.meta_description?.length).toBeLessThanOrEqual(161); // 160 + ellipsis char
    expect(result.meta_description?.endsWith("…")).toBe(true);
  });
});

describe("parseBlogPostMetadata — priority order", () => {
  it("YAML beats inline beats HTML beats H1", () => {
    const text = `---
title: YAML Wins
---

Title: Inline Loses

<title>HTML Loses</title>

# H1 Loses

Body.`;
    const result = parseBlogPostMetadata(text);
    expect(result.title).toBe("YAML Wins");
    expect(result.source_map.title).toBe("yaml");
  });
});

describe("parseBlogPostMetadata — empty / pathological", () => {
  it("returns all-null when input is empty", () => {
    const result = parseBlogPostMetadata("");
    expect(result.title).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.meta_title).toBeNull();
    expect(result.meta_description).toBeNull();
  });

  it("handles unterminated YAML block gracefully (treats as body)", () => {
    const text = `---
title: Never Closed

Body without closing fence.`;
    const result = parseBlogPostMetadata(text);
    // No title parsed from YAML (no closing ---); inline label
    // "title:" sits after `---` so it's not at the very top either.
    expect(result.source_map.title).not.toBe("yaml");
  });
});
