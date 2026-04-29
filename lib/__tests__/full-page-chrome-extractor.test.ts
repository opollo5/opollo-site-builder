import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractFullPageChrome } from "@/lib/full-page-chrome-extractor";

// OPTIMISER PHASE 1.5 SLICE 14 — chrome extraction matrix.
//
// fetch is global; we stub it per test rather than spinning up a
// fixture server. The extractor is pure aside from the network call.

describe("extractFullPageChrome", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockHomepage(html: string, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(html, {
        status,
        headers: { "content-type": "text/html" },
      }),
    );
  }

  it("extracts header, nav, and footer from a vanilla page", async () => {
    mockHomepage(`
      <!DOCTYPE html>
      <html><body>
        <header><h1>Brand</h1></header>
        <nav><ul><li>Home</li></ul></nav>
        <main><p>Body</p></main>
        <footer>© 2026</footer>
      </body></html>
    `);

    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chrome.header_html).toContain("<h1>Brand</h1>");
    expect(result.chrome.nav_html).toContain("<li>Home</li>");
    expect(result.chrome.footer_html).toContain("© 2026");
    expect(result.chrome.source_url).toBe("https://example.com");
  });

  it("returns NO_CHROME_FOUND when the page has no chrome elements", async () => {
    mockHomepage(`<html><body><div>Hello</div></body></html>`);
    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NO_CHROME_FOUND");
  });

  it("succeeds when only one of the three chrome elements is present", async () => {
    mockHomepage(`<html><body><nav>Just nav</nav></body></html>`);
    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chrome.nav_html).toContain("Just nav");
    expect(result.chrome.header_html).toBe("");
    expect(result.chrome.footer_html).toBe("");
  });

  it("handles nested same-name tags by matching the document-level instance", async () => {
    mockHomepage(`
      <html><body>
        <header class="site">
          <article><header class="card">card hdr</header></article>
          <h1>Site Brand</h1>
        </header>
      </body></html>
    `);
    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The whole outer header (with nested) is captured.
    expect(result.chrome.header_html).toContain('class="site"');
    expect(result.chrome.header_html).toContain('class="card"');
    expect(result.chrome.header_html).toContain("Site Brand");
  });

  it("rejects non-http URLs", async () => {
    const result = await extractFullPageChrome("ftp://example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_URL");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces HTTP errors", async () => {
    mockHomepage("server down", 500);
    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("HTTP_ERROR");
    expect(result.error.message).toContain("500");
  });

  it("surfaces network errors", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ECONNRESET"),
    );
    const result = await extractFullPageChrome("https://example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FETCH_FAILED");
    expect(result.error.message).toContain("ECONNRESET");
  });
});
