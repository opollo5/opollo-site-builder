import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractBlogStyling,
  registrableDomainOf,
} from "@/lib/copy-existing-extract";

// Spec 03 §1.2 vitest — blog-styling extraction.
//
// The extractor uses fetch() with an 8s timeout per URL. We stub
// global.fetch with a synchronous mock that returns canned HTML so
// the test suite runs offline without hitting the network or the
// vitest globalSetup Supabase stack.

type FetchMock = (input: string) => Promise<Response>;

function mockFetch(handler: FetchMock): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as unknown as typeof fetch;
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html" },
  });
}

const PRIMARY = "https://example.com";

beforeEach(() => {
  // Reset fetch each test; tests that need it call mockFetch().
  global.fetch = undefined as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registrableDomainOf", () => {
  it("treats subdomains as same registrable domain", () => {
    expect(registrableDomainOf("https://blog.example.com/post")).toBe(
      "example.com",
    );
    expect(registrableDomainOf("https://example.com/")).toBe("example.com");
  });

  it("handles multi-part TLDs (.co.uk, .com.au)", () => {
    expect(registrableDomainOf("https://www.example.co.uk")).toBe(
      "example.co.uk",
    );
    expect(registrableDomainOf("https://example.com.au")).toBe(
      "example.com.au",
    );
  });

  it("returns null for unparseable URLs", () => {
    expect(registrableDomainOf("not-a-url")).toBeNull();
  });
});

describe("extractBlogStyling — same-origin filtering", () => {
  it("rejects URLs on a different registrable domain with a note", async () => {
    mockFetch(async () => htmlResponse("<html><body></body></html>"));
    const res = await extractBlogStyling(PRIMARY, [
      "https://other-site.com/post-1",
    ]);
    expect(
      res.notes.some((n) =>
        n.includes("Ignored blog URL on different registrable domain"),
      ),
    ).toBe(true);
    expect(res.blog_styling.source_blog_urls).toEqual([]);
  });

  it("accepts a subdomain of the primary domain", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body><article><p class="entry-content">Hi</p></article></body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://blog.example.com/post-1",
    ]);
    expect(res.blog_styling.source_blog_urls).toEqual([
      "https://blog.example.com/post-1",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
  });
});

describe("extractBlogStyling — utility-class filtering", () => {
  it("ignores Tailwind utilities, keeps the longest semantic class", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <article>
            <p class="mb-4 text-gray-700 entry-content">Hi</p>
            <p class="mb-4 text-gray-700 entry-content">More</p>
          </article>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/post-1",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
  });

  it("leaves bucket null when only utilities are present", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <article>
            <p class="mb-4">No semantic class.</p>
          </article>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/post-1",
    ]);
    expect(res.blog_styling.paragraph).toBeNull();
  });

  it("dedupes repeated classes inside one element", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <article>
            <p class="entry-content entry-content">x</p>
          </article>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/post-1",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
  });

  it("picks the longest semantic survivor when multiple semantic classes exist", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <article>
            <p class="prose-lg article-body entry-content">x</p>
          </article>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/post-1",
    ]);
    // entry-content (13) > article-body (12); prose-lg rejected by 'lg:' pattern semantics — but our regex is on full class so 'prose-lg' survives utility filter (it's >=4 and doesn't match the listed util prefixes). entry-content still wins by length.
    expect(res.blog_styling.paragraph).toBe("entry-content");
  });
});

describe("extractBlogStyling — cross-URL consistency", () => {
  function articleHtml(paragraphClass: string, h2Class: string): string {
    return `<html><body>
      <article>
        <h2 class="${h2Class}">Heading</h2>
        <p class="${paragraphClass}">x</p>
      </article>
    </body></html>`;
  }

  it("3-URL agree case: takes the value", async () => {
    mockFetch(async () =>
      htmlResponse(articleHtml("entry-content", "wp-block-heading")),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
    expect(res.blog_styling.article_h2).toBe("wp-block-heading");
  });

  it("3-URL majority (2-of-3): uses majority and notes the minority", async () => {
    let i = 0;
    mockFetch(async () => {
      i += 1;
      const cls = i === 3 ? "post-paragraph" : "entry-content";
      return htmlResponse(articleHtml(cls, "wp-block-heading"));
    });
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
    expect(
      res.notes.some((n) => /Inconsistent paragraph class/.test(n)),
    ).toBe(true);
  });

  it("3-URL all-differ: leaves bucket null and notes inconsistency", async () => {
    let i = 0;
    mockFetch(async () => {
      i += 1;
      const cls = `paragraph-style-${i}`;
      return htmlResponse(articleHtml(cls, "wp-block-heading"));
    });
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3",
    ]);
    expect(res.blog_styling.paragraph).toBeNull();
    expect(
      res.notes.some((n) =>
        /Inconsistent paragraph classes across blogs — leaving null/.test(n),
      ),
    ).toBe(true);
  });

  it("2-URL agree case: takes the value", async () => {
    mockFetch(async () =>
      htmlResponse(articleHtml("entry-content", "wp-block-heading")),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
      "https://example.com/p2",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
  });

  it("1-URL: takes the value but emits a low-confidence note", async () => {
    mockFetch(async () =>
      htmlResponse(articleHtml("entry-content", "wp-block-heading")),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
    ]);
    expect(res.blog_styling.paragraph).toBe("entry-content");
    expect(
      res.notes.some((n) => /Single-URL extraction/.test(n)),
    ).toBe(true);
  });

  it("timeout on URL 2 of 3: merges the survivors as a 2-URL case + timeout note", async () => {
    let n = 0;
    mockFetch(async (url) => {
      n += 1;
      if (url.includes("/p2")) {
        // Fail fast — the extractor treats a non-2xx as a fetch
        // failure; the spec wording "timeout" is one of several
        // failure modes that all funnel into the same merge path.
        return htmlResponse("error", 503);
      }
      return htmlResponse(articleHtml("entry-content", "wp-block-heading"));
    });
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
      "https://example.com/p2",
      "https://example.com/p3",
    ]);
    void n;
    expect(res.blog_styling.paragraph).toBe("entry-content");
    expect(res.notes.some((nt) => /URL 2 failed to load/.test(nt))).toBe(true);
  });
});

describe("extractBlogStyling — container detection", () => {
  it("falls back through <main>, .post-content, .entry-content", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <div class="entry-content">
            <p class="text-block">Hi</p>
          </div>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
    ]);
    expect(res.blog_styling.paragraph).toBe("text-block");
  });

  it("returns nulls + skip note when no container matches", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body>
          <div class="navbar"><a href="#">Home</a></div>
        </body></html>`,
      ),
    );
    const res = await extractBlogStyling(PRIMARY, [
      "https://example.com/p1",
    ]);
    expect(res.blog_styling.paragraph).toBeNull();
    expect(
      res.notes.some((n) => /no recognised article container/i.test(n)),
    ).toBe(true);
  });

  it("survives malformed HTML without throwing", async () => {
    mockFetch(async () =>
      htmlResponse(
        `<html><body><article><p class="entry-content">missing close tag`,
      ),
    );
    await expect(
      extractBlogStyling(PRIMARY, ["https://example.com/p1"]),
    ).resolves.toBeDefined();
  });
});
