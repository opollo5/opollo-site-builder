import { describe, expect, it } from "vitest";

import {
  CHAR_LIMIT,
  matchTaxonomy,
  normalizeTags,
  parseMarkdownTable,
  urlToSlug,
} from "@/lib/ai-prefill";

// ---------------------------------------------------------------------------
// FIXTURE_A — complete pipe-table with all required metadata fields.
// Pre-extractor should return a full ExtractResult (no LLM call needed).
// ---------------------------------------------------------------------------
const FIXTURE_A = `
| **SEO Title** | 10 Marketing Tips for 2025 |
| --- | --- |
| **SEO Meta Description** | Discover the top 10 marketing strategies that will grow your business in 2025. |
| **Category** | Marketing |
| **Tags** | #content-marketing #seo #growth |
| **URL** | https://example.com/blog/10-marketing-tips-2025 |

# 10 Marketing Tips for 2025

Marketing is always evolving. Here are ten tips to help your business grow this year.

## 1. Focus on SEO

Search engine optimisation remains the most cost-effective way to drive traffic.
`.trim();

// ---------------------------------------------------------------------------
// FIXTURE_B — pipe-table missing Tags row (only 4 qualifying labels).
// Pre-extractor should still fire (≥3 qualifiers), but tags array is empty;
// the extract() gating logic then falls through to LLM.
// ---------------------------------------------------------------------------
const FIXTURE_B = `
| **SEO Title** | How to Write Great Blog Posts |
| --- | --- |
| **SEO Meta Description** | Learn the proven framework for writing blog posts that rank. |
| **Category** | Writing |
| **URL** | https://example.com/writing-tips |

# How to Write Great Blog Posts

Start with a strong hook.
`.trim();

// ---------------------------------------------------------------------------
// FIXTURE_C — no pipe-table at all; plain blog content only.
// parseMarkdownTable should return null.
// ---------------------------------------------------------------------------
const FIXTURE_C = `
# The Future of AI in Marketing

Artificial intelligence is reshaping how marketers work. From personalisation to
predictive analytics, AI tools are becoming indispensable.

## Why AI Matters

Marketers who adopt AI early will have a significant competitive advantage.
`.trim();

// ---------------------------------------------------------------------------
// FIXTURE_D — text longer than CHAR_LIMIT to test truncation.
// The truncated flag should be set and the content cut at 20,000 chars.
// ---------------------------------------------------------------------------
const FIXTURE_D = "x".repeat(CHAR_LIMIT + 1_000);

// ---------------------------------------------------------------------------
// FIXTURE_E — pipe-table with multi-word tags and mixed casing.
// Tests normalizeTags + matchTaxonomy together.
// ---------------------------------------------------------------------------
const FIXTURE_E = `
| **SEO Title** | Email Marketing Best Practices |
| --- | --- |
| **SEO Meta Description** | Everything you need to know about email marketing in one guide. |
| **Category** | email marketing |
| **Tags** | #Email #best-practices #Automation |
| **URL** | https://example.com/email-marketing |

# Email Marketing Best Practices

Email remains one of the highest-ROI marketing channels available.
`.trim();

// ---------------------------------------------------------------------------
// normalizeTags
// ---------------------------------------------------------------------------
describe("normalizeTags", () => {
  it("strips leading # from each tag", () => {
    expect(normalizeTags("#tagA #tagB #tagC")).toEqual(["tagA", "tagB", "tagC"]);
  });

  it("handles tags without # prefix", () => {
    expect(normalizeTags("marketing seo growth")).toEqual(["marketing", "seo", "growth"]);
  });

  it("returns empty array for empty string", () => {
    expect(normalizeTags("")).toEqual([]);
  });

  it("handles whitespace-only string", () => {
    expect(normalizeTags("   ")).toEqual([]);
  });

  it("preserves original casing", () => {
    expect(normalizeTags("#Email #Best-Practices")).toEqual(["Email", "Best-Practices"]);
  });

  it("handles single tag", () => {
    expect(normalizeTags("#solo")).toEqual(["solo"]);
  });
});

// ---------------------------------------------------------------------------
// urlToSlug
// ---------------------------------------------------------------------------
describe("urlToSlug", () => {
  it("returns final path segment", () => {
    expect(urlToSlug("https://example.com/blog/my-post")).toBe("my-post");
  });

  it("strips query string before splitting", () => {
    expect(urlToSlug("https://example.com/blog/post-title?foo=bar&baz=1")).toBe("post-title");
  });

  it("returns last segment for nested paths", () => {
    expect(urlToSlug("https://example.com/a/b/c/d")).toBe("d");
  });

  it("returns empty string for empty string input", () => {
    expect(urlToSlug("")).toBe("");
  });

  it("returns last segment for single-segment path", () => {
    expect(urlToSlug("https://example.com/my-post")).toBe("my-post");
  });

  it("handles the FIXTURE_A URL", () => {
    expect(urlToSlug("https://example.com/blog/10-marketing-tips-2025")).toBe(
      "10-marketing-tips-2025",
    );
  });
});

// ---------------------------------------------------------------------------
// matchTaxonomy
// ---------------------------------------------------------------------------
describe("matchTaxonomy", () => {
  it("returns isNew:false with canonical casing when exact match exists", () => {
    expect(matchTaxonomy("Marketing", ["Marketing", "SEO"])).toEqual({
      name: "Marketing",
      isNew: false,
    });
  });

  it("matches case-insensitively and returns canonical casing", () => {
    expect(matchTaxonomy("marketing", ["Marketing", "SEO"])).toEqual({
      name: "Marketing",
      isNew: false,
    });
  });

  it("returns isNew:true with source casing when no match", () => {
    expect(matchTaxonomy("NewCategory", ["Marketing"])).toEqual({
      name: "NewCategory",
      isNew: true,
    });
  });

  it("returns isNew:true for empty available list", () => {
    expect(matchTaxonomy("Anything", [])).toEqual({ name: "Anything", isNew: true });
  });
});

// ---------------------------------------------------------------------------
// parseMarkdownTable
// ---------------------------------------------------------------------------
describe("parseMarkdownTable", () => {
  it("FIXTURE_A — returns full result with all fields populated", () => {
    const result = parseMarkdownTable(FIXTURE_A, ["Marketing"], ["content-marketing", "seo", "growth"]);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("10 Marketing Tips for 2025");
    expect(result!.seo_title).toBe("10 Marketing Tips for 2025");
    expect(result!.meta_description).toMatch(/top 10 marketing/i);
    expect(result!.slug).toBe("10-marketing-tips-2025");
    expect(result!.categories).toHaveLength(1);
    expect(result!.categories[0]!.name).toBe("Marketing");
    expect(result!.categories[0]!.isNew).toBe(false);
    expect(result!.tags).toHaveLength(3);
    expect(result!.truncated).toBe(false);
  });

  it("FIXTURE_A — content starts after the H1, not including the title line", () => {
    const result = parseMarkdownTable(FIXTURE_A, [], []);
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Marketing is always evolving");
    expect(result!.content).not.toContain("10 Marketing Tips for 2025");
  });

  it("FIXTURE_B — returns non-null result (≥3 qualifiers even without tags)", () => {
    const result = parseMarkdownTable(FIXTURE_B, ["Writing"], []);
    expect(result).not.toBeNull();
    expect(result!.seo_title).toBe("How to Write Great Blog Posts");
    expect(result!.categories).toHaveLength(1);
    expect(result!.tags).toHaveLength(0);
  });

  it("FIXTURE_C — returns null for content with no pipe-table", () => {
    expect(parseMarkdownTable(FIXTURE_C, [], [])).toBeNull();
  });

  it("FIXTURE_E — category match is case-insensitive", () => {
    const result = parseMarkdownTable(FIXTURE_E, ["Email Marketing"], []);
    expect(result).not.toBeNull();
    expect(result!.categories[0]!.name).toBe("Email Marketing");
    expect(result!.categories[0]!.isNew).toBe(false);
  });

  it("FIXTURE_E — tags preserve source casing for new tags, canonical for existing", () => {
    const result = parseMarkdownTable(FIXTURE_E, [], ["best-practices"]);
    expect(result).not.toBeNull();
    const tagMap = Object.fromEntries(result!.tags.map((t) => [t.name, t.isNew]));
    expect(tagMap["Email"]).toBe(true);
    expect(tagMap["best-practices"]).toBe(false);
    expect(tagMap["Automation"]).toBe(true);
  });

  it("returns null when fewer than 3 qualifying labels present", () => {
    const sparse = `
| **SEO Title** | Some Title |
| --- | --- |
| **URL** | https://example.com/some |

# Title

Content here.
`.trim();
    expect(parseMarkdownTable(sparse, [], [])).toBeNull();
  });

  it("skips separator rows (--- lines) in the table", () => {
    const result = parseMarkdownTable(FIXTURE_A, [], []);
    expect(result).not.toBeNull();
    // None of the field values should be "---"
    expect(result!.seo_title).not.toBe("---");
    expect(result!.meta_description).not.toBe("---");
  });
});

// ---------------------------------------------------------------------------
// Truncation (CHAR_LIMIT boundary)
// ---------------------------------------------------------------------------
describe("CHAR_LIMIT", () => {
  it("is 20,000 characters", () => {
    expect(CHAR_LIMIT).toBe(20_000);
  });

  it("FIXTURE_D is longer than CHAR_LIMIT", () => {
    expect(FIXTURE_D.length).toBeGreaterThan(CHAR_LIMIT);
  });
});
