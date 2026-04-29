import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSourcePage } from "@/lib/optimiser/page-import/fetch-source";

// OPTIMISER PHASE 1.5 SLICE 17 — source-page fetcher.

describe("fetchSourcePage", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockResponse(html: string, opts: { status?: number; url?: string } = {}) {
    const res = new Response(html, {
      status: opts.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    if (opts.url) {
      Object.defineProperty(res, "url", { value: opts.url, configurable: true });
    }
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);
  }

  it("returns the HTML on success", async () => {
    mockResponse("<html><body>Hi</body></html>", {
      url: "https://example.com/page",
    });
    const r = await fetchSourcePage({ url: "https://example.com/page" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("<body>Hi</body>");
    expect(r.body_size).toBeGreaterThan(0);
    expect(r.url).toBe("https://example.com/page");
  });

  it("rejects non-http(s) URLs without fetching", async () => {
    const r = await fetchSourcePage({ url: "ftp://example.com" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INVALID_URL");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces HTTP errors", async () => {
    mockResponse("server boom", { status: 503 });
    const r = await fetchSourcePage({ url: "https://example.com" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("HTTP_ERROR");
    expect(r.error.message).toContain("503");
  });

  it("surfaces network errors", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ECONNRESET"),
    );
    const r = await fetchSourcePage({ url: "https://example.com" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("FETCH_FAILED");
    expect(r.error.message).toContain("ECONNRESET");
  });

  it("captures content-type header", async () => {
    mockResponse("<html></html>");
    const r = await fetchSourcePage({ url: "https://example.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content_type).toContain("text/html");
  });
});
