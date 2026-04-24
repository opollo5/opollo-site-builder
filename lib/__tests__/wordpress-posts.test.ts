import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  wpCreatePost,
  wpDeletePost,
  wpGetPostBySlug,
  wpUpdatePost,
  type WpConfig,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-2 — wpCreatePost / wpUpdatePost / wpGetPostBySlug / wpDeletePost
// unit tests.
//
// No real WordPress. All fetch calls are stubbed via
// vi.stubGlobal("fetch", …) exactly like the existing wordpress.test.ts
// — same mock shape, same fake-timer pattern to skip wpFetch's
// exponential-backoff delays.
// ---------------------------------------------------------------------------

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function htmlResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const FAKE_CFG: WpConfig = {
  baseUrl: "https://example.wp.test",
  user: "admin",
  appPassword: "xxxx yyyy zzzz",
};

const EXPECTED_AUTH =
  "Basic " + Buffer.from("admin:xxxx yyyy zzzz").toString("base64");

const FAKE_WP_POST = {
  id: 77,
  title: { rendered: "Test Post", raw: "Test Post" },
  slug: "test-post",
  status: "draft",
  link: "https://example.wp.test/?p=77",
  content: { rendered: "<p>Hi</p>", raw: "<p>Hi</p>" },
  excerpt: { rendered: "Short desc", raw: "Short desc" },
  categories: [3, 5],
  tags: [11],
  featured_media: 42,
  modified_gmt: "2026-04-24T10:00:00Z",
  modified: "2026-04-24T10:00:00Z",
};

const WP_403_BODY = {
  code: "rest_cannot_create",
  message: "Sorry, you are not allowed to create posts as this user.",
  data: { status: 403 },
};

const mockFetch = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
  const promise = fn();
  await vi.runAllTimersAsync();
  return promise;
}

// ---------------------------------------------------------------------------
// wpCreatePost
// ---------------------------------------------------------------------------

describe("wpCreatePost", () => {
  const INPUT = {
    title: "Kadence tuning",
    slug: "kadence-tuning",
    content: "<p>Full post body.</p>",
    excerpt: "A short excerpt for feeds.",
    categories: [3, 5],
    tags: [11],
    featured_media: 42,
  };

  it("happy path: returns post_id, preview_url, admin_url, slug, status, link", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));

    const result = await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.post_id).toBe(77);
    expect(result.slug).toBe("test-post");
    expect(result.status).toBe("draft");
    expect(result.preview_url).toContain("?p=77");
    expect(result.preview_url).toContain("preview=true");
    expect(result.admin_url).toContain("post=77");
    expect(result.admin_url).toContain("action=edit");
    expect(result.link).toBe("https://example.wp.test/?p=77");
  });

  it("posts to /wp-json/wp/v2/posts (not /pages)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.wp.test/wp-json/wp/v2/posts");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("sends Basic Auth + JSON Content-Type", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    const [, init] = mockFetch.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(EXPECTED_AUTH);
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("defaults status to 'draft' when omitted", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.status).toBe("draft");
    expect(body.title).toBe("Kadence tuning");
    expect(body.slug).toBe("kadence-tuning");
    expect(body.content).toBe(INPUT.content);
    expect(body.excerpt).toBe(INPUT.excerpt);
    expect(body.categories).toEqual([3, 5]);
    expect(body.tags).toEqual([11]);
    expect(body.featured_media).toBe(42);
  });

  it("forwards explicit status=publish", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(201, { ...FAKE_WP_POST, status: "publish" }),
    );
    await callAndFlush(() =>
      wpCreatePost(FAKE_CFG, { ...INPUT, status: "publish" }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.status).toBe("publish");
  });

  it("omits optional fields when undefined (categories / tags / excerpt / featured_media / meta)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() =>
      wpCreatePost(FAKE_CFG, {
        title: "Minimal",
        slug: "minimal",
        content: "<p>Minimal body.</p>",
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(body).sort()).toEqual(["content", "slug", "status", "title"]);
  });

  it("forwards a `meta` object for SEO plugin meta fields", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_POST));
    await callAndFlush(() =>
      wpCreatePost(FAKE_CFG, {
        ...INPUT,
        meta: { yoast_wpseo_metadesc: "A short description for search." },
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.meta).toEqual({
      yoast_wpseo_metadesc: "A short description for search.",
    });
  });

  it("403 JSON with rest_cannot_create: returns AUTH_FAILED (retryable:false)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(403, WP_403_BODY));
    const result = await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("AUTH_FAILED");
    expect(result.retryable).toBe(false);
  });

  it("403 non-JSON (WAF block): returns UPSTREAM_BLOCKED", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlResponse(403, "<html><body>Forbidden by security plugin</body></html>"),
    );
    const result = await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("UPSTREAM_BLOCKED");
  });

  it("500 retries up to 3 times then returns WP_API_ERROR (retryable:true)", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, { message: "oops" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "oops" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "oops" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "oops" }));
    const result = await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("WP_API_ERROR");
    expect(result.retryable).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("429 returns RATE_LIMIT (retryable:true)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { message: "slow down" }));
    const result = await callAndFlush(() => wpCreatePost(FAKE_CFG, INPUT));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("RATE_LIMIT");
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wpUpdatePost
// ---------------------------------------------------------------------------

describe("wpUpdatePost", () => {
  it("POSTs to /wp-json/wp/v2/posts/:id with only the supplied fields", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { ...FAKE_WP_POST, status: "publish" }),
    );
    await callAndFlush(() =>
      wpUpdatePost(FAKE_CFG, 77, { title: "Renamed", status: "publish" }),
    );
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.wp.test/wp-json/wp/v2/posts/77");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ title: "Renamed", status: "publish" });
  });

  it("returns slug + status + modified_date from the response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { ...FAKE_WP_POST, slug: "renamed", status: "publish" }),
    );
    const result = await callAndFlush(() =>
      wpUpdatePost(FAKE_CFG, 77, { title: "Renamed" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.post_id).toBe(77);
    expect(result.slug).toBe("renamed");
    expect(result.status).toBe("publish");
    expect(result.modified_date).toBe("2026-04-24T10:00:00Z");
  });

  it("omits fields not set in the patch", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, FAKE_WP_POST));
    await callAndFlush(() => wpUpdatePost(FAKE_CFG, 77, { excerpt: "New excerpt" }));
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ excerpt: "New excerpt" });
  });

  it("forwards category + tag + featured_media + meta when supplied", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, FAKE_WP_POST));
    await callAndFlush(() =>
      wpUpdatePost(FAKE_CFG, 77, {
        categories: [9],
        tags: [12, 13],
        featured_media: 99,
        meta: { rank_math_title: "Custom title" },
      }),
    );
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.categories).toEqual([9]);
    expect(body.tags).toEqual([12, 13]);
    expect(body.featured_media).toBe(99);
    expect(body.meta).toEqual({ rank_math_title: "Custom title" });
  });

  it("404 returns NOT_FOUND", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(404, {
        code: "rest_post_invalid_id",
        message: "Invalid post ID.",
        data: { status: 404 },
      }),
    );
    const result = await callAndFlush(() =>
      wpUpdatePost(FAKE_CFG, 9999, { title: "nope" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// wpGetPostBySlug
// ---------------------------------------------------------------------------

describe("wpGetPostBySlug", () => {
  it("GETs /wp-json/wp/v2/posts?slug=...&status=any&per_page=1&context=edit", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, [FAKE_WP_POST]));
    await callAndFlush(() => wpGetPostBySlug(FAKE_CFG, "test-post"));
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain("/wp-json/wp/v2/posts?");
    expect(String(url)).toContain("slug=test-post");
    expect(String(url)).toContain("status=any");
    expect(String(url)).toContain("per_page=1");
    expect(String(url)).toContain("context=edit");
    expect((init as RequestInit).method).toBe("GET");
  });

  it("returns the post record when found", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, [FAKE_WP_POST]));
    const result = await callAndFlush(() =>
      wpGetPostBySlug(FAKE_CFG, "test-post"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.post_id).toBe(77);
    expect(result.slug).toBe("test-post");
    expect(result.title).toBe("Test Post");
    expect(result.content).toBe("<p>Hi</p>");
    expect(result.excerpt).toBe("Short desc");
    expect(result.status).toBe("draft");
    expect(result.categories).toEqual([3, 5]);
    expect(result.tags).toEqual([11]);
    expect(result.featured_media).toBe(42);
    expect(result.link).toBe("https://example.wp.test/?p=77");
  });

  it("returns NOT_FOUND when WP responds with an empty array", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, []));
    const result = await callAndFlush(() =>
      wpGetPostBySlug(FAKE_CFG, "ghost-slug"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NOT_FOUND");
    expect(result.details?.slug).toBe("ghost-slug");
  });

  it("accepts a status filter", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, [FAKE_WP_POST]));
    await callAndFlush(() =>
      wpGetPostBySlug(FAKE_CFG, "test-post", { status: "publish" }),
    );
    const [url] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain("status=publish");
  });

  it("treats featured_media=0 as null", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, [{ ...FAKE_WP_POST, featured_media: 0 }]),
    );
    const result = await callAndFlush(() =>
      wpGetPostBySlug(FAKE_CFG, "test-post"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.featured_media).toBeNull();
  });

  it("401 returns AUTH_FAILED", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(401, {
        code: "rest_cannot_edit",
        message: "nope",
        data: { status: 401 },
      }),
    );
    const result = await callAndFlush(() =>
      wpGetPostBySlug(FAKE_CFG, "test-post"),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("AUTH_FAILED");
  });
});

// ---------------------------------------------------------------------------
// wpDeletePost
// ---------------------------------------------------------------------------

describe("wpDeletePost", () => {
  it("DELETEs /wp-json/wp/v2/posts/:id with no force flag by default and returns status='trash'", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 77, status: "trash" }));
    const result = await callAndFlush(() => wpDeletePost(FAKE_CFG, 77));
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.wp.test/wp-json/wp/v2/posts/77");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.post_id).toBe(77);
    expect(result.status).toBe("trash");
  });

  it("passes ?force=true when opts.force=true and returns status='deleted'", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { deleted: true, previous: { id: 77 } }),
    );
    const result = await callAndFlush(() =>
      wpDeletePost(FAKE_CFG, 77, { force: true }),
    );
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.wp.test/wp-json/wp/v2/posts/77?force=true");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.post_id).toBe(77);
    expect(result.status).toBe("deleted");
  });

  it("404 returns NOT_FOUND", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(404, {
        code: "rest_post_invalid_id",
        message: "Invalid post ID.",
        data: { status: 404 },
      }),
    );
    const result = await callAndFlush(() => wpDeletePost(FAKE_CFG, 9999));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NOT_FOUND");
  });

  it("network failure: returns NETWORK_ERROR (retryable:true)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await callAndFlush(() => wpDeletePost(FAKE_CFG, 77));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NETWORK_ERROR");
    expect(result.retryable).toBe(true);
  });
});
