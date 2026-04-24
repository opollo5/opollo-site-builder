import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readWpConfig,
  runWithWpCredentials,
  wpCreatePage,
  wpDeletePage,
  wpGetPage,
  wpListPages,
  wpPublishPage,
  wpUpdatePage,
  type WpConfig,
  type WpCredentialsOverride,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// lib/wordpress.ts unit tests — Phase 3c of the M15-7 fix pass.
//
// No real WordPress, no Supabase. All fetch calls are stubbed via
// vi.stubGlobal("fetch", …). Timer fakes collapse the exponential-backoff
// delays in wpFetch's retry loop so tests complete instantly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
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

// Expected Authorization header: Basic base64("admin:xxxx yyyy zzzz")
const EXPECTED_AUTH =
  "Basic " + Buffer.from("admin:xxxx yyyy zzzz").toString("base64");

// Fake WP page body returned by WP REST API on success
const FAKE_WP_PAGE = {
  id: 42,
  title: { rendered: "Test Page", raw: "Test Page" },
  slug: "test-page",
  status: "draft",
  link: "https://example.wp.test/test-page/",
  parent: 0,
  modified_gmt: "2026-04-24T10:00:00Z",
  modified: "2026-04-24T10:00:00Z",
  content: { rendered: "<p>Hello</p>", raw: "<p>Hello</p>" },
  excerpt: { rendered: "A short desc", raw: "A short desc" },
};

// WP 401 body shape
const WP_401_BODY = {
  code: "rest_cannot_create",
  message: "Sorry, you are not allowed to create posts as this user.",
  data: { status: 401 },
};

// ---------------------------------------------------------------------------
// Setup — stub global fetch; use fake timers to skip backoff delays
// ---------------------------------------------------------------------------

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

// Helper: return a response that always resolves (skipping fake-timer delays)
// by running all pending timers after each mock call.
async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
  const promise = fn();
  // Drain all scheduled timers (the retry backoff sleeps) in a loop until
  // the promise resolves. We alternate: advance timers, yield microtasks.
  await vi.runAllTimersAsync();
  return promise;
}

// ---------------------------------------------------------------------------
// readWpConfig
// ---------------------------------------------------------------------------

const WP_ENV = [
  "LEADSOURCE_WP_URL",
  "LEADSOURCE_WP_USER",
  "LEADSOURCE_WP_APP_PASSWORD",
] as const;

describe("lib/wordpress", () => {
  describe("readWpConfig", () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of WP_ENV) saved[k] = process.env[k];
    });

    afterEach(() => {
      for (const k of WP_ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it("returns ok:true with all three env vars set", () => {
      process.env.LEADSOURCE_WP_URL = "https://site.test";
      process.env.LEADSOURCE_WP_USER = "bob";
      process.env.LEADSOURCE_WP_APP_PASSWORD = "pass1234";

      const result = readWpConfig();

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.value.baseUrl).toBe("https://site.test");
      expect(result.value.user).toBe("bob");
      expect(result.value.appPassword).toBe("pass1234");
    });

    it("returns ok:false with missing key listed when one env var is absent", () => {
      process.env.LEADSOURCE_WP_URL = "https://site.test";
      process.env.LEADSOURCE_WP_USER = "bob";
      delete process.env.LEADSOURCE_WP_APP_PASSWORD;

      const result = readWpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.missing).toContain("LEADSOURCE_WP_APP_PASSWORD");
      expect(result.missing).toHaveLength(1);
    });

    it("returns ok:false with all three keys listed when all env vars are absent", () => {
      delete process.env.LEADSOURCE_WP_URL;
      delete process.env.LEADSOURCE_WP_USER;
      delete process.env.LEADSOURCE_WP_APP_PASSWORD;

      const result = readWpConfig();

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.missing).toContain("LEADSOURCE_WP_URL");
      expect(result.missing).toContain("LEADSOURCE_WP_USER");
      expect(result.missing).toContain("LEADSOURCE_WP_APP_PASSWORD");
      expect(result.missing).toHaveLength(3);
    });

    it("uses AsyncLocalStorage override when runWithWpCredentials is active", async () => {
      // No env vars set — should still resolve via the override
      delete process.env.LEADSOURCE_WP_URL;
      delete process.env.LEADSOURCE_WP_USER;
      delete process.env.LEADSOURCE_WP_APP_PASSWORD;

      const creds: WpCredentialsOverride = {
        wp_url: "https://override.test",
        wp_user: "overrideUser",
        wp_app_password: "override-pass",
      };

      let result: ReturnType<typeof readWpConfig> | null = null;
      await runWithWpCredentials(creds, async () => {
        result = readWpConfig();
      });

      expect(result).not.toBeNull();
      const r = result!;
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("narrowing");
      expect(r.value.baseUrl).toBe("https://override.test");
      expect(r.value.user).toBe("overrideUser");
      expect(r.value.appPassword).toBe("override-pass");
    });
  });

  // ---------------------------------------------------------------------------
  // runWithWpCredentials
  // ---------------------------------------------------------------------------

  describe("runWithWpCredentials", () => {
    it("executes fn directly and returns its value when creds is undefined", async () => {
      let called = false;
      const result = await runWithWpCredentials(undefined, async () => {
        called = true;
        return 42;
      });
      expect(called).toBe(true);
      expect(result).toBe(42);
    });

    it("makes credentials available inside the callback via readWpConfig", async () => {
      const creds: WpCredentialsOverride = {
        wp_url: "https://inner.test",
        wp_user: "innerUser",
        wp_app_password: "inner-pass",
      };

      let innerResult: ReturnType<typeof readWpConfig> | null = null;
      await runWithWpCredentials(creds, async () => {
        innerResult = readWpConfig();
      });

      const ir = innerResult!;
      expect(ir.ok).toBe(true);
      if (!ir.ok) throw new Error("narrowing");
      expect(ir.value.baseUrl).toBe("https://inner.test");
    });

    it("credentials are not visible outside the callback", async () => {
      const creds: WpCredentialsOverride = {
        wp_url: "https://outer.test",
        wp_user: "outerUser",
        wp_app_password: "outer-pass",
      };

      // Remove env vars so readWpConfig() without override returns ok:false
      const savedUrl = process.env.LEADSOURCE_WP_URL;
      const savedUser = process.env.LEADSOURCE_WP_USER;
      const savedPw = process.env.LEADSOURCE_WP_APP_PASSWORD;
      delete process.env.LEADSOURCE_WP_URL;
      delete process.env.LEADSOURCE_WP_USER;
      delete process.env.LEADSOURCE_WP_APP_PASSWORD;

      await runWithWpCredentials(creds, async () => {
        /* just run it */
      });

      // After the callback, the store should be unset
      const afterResult = readWpConfig();
      expect(afterResult.ok).toBe(false);

      // Restore
      if (savedUrl !== undefined) process.env.LEADSOURCE_WP_URL = savedUrl;
      if (savedUser !== undefined) process.env.LEADSOURCE_WP_USER = savedUser;
      if (savedPw !== undefined) process.env.LEADSOURCE_WP_APP_PASSWORD = savedPw;
    });
  });

  // ---------------------------------------------------------------------------
  // wpCreatePage
  // ---------------------------------------------------------------------------

  describe("wpCreatePage", () => {
    const INPUT = {
      title: "Test Page",
      slug: "test-page",
      content: "<p>Hello world with enough content to pass validation</p>",
      meta_description:
        "A short but valid meta description for this test page fixture.",
      template_type: "generic" as const,
      ds_version: "1.0.0",
    };

    it("happy path: returns ok:true with page_id, preview_url, admin_url, slug, status", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      const result = await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
      expect(result.slug).toBe("test-page");
      expect(result.status).toBe("draft");
      expect(result.preview_url).toContain("?page_id=42");
      expect(result.preview_url).toContain("preview=true");
      expect(result.admin_url).toContain("post=42");
      expect(result.admin_url).toContain("action=edit");
    });

    it("sends POST to /wp-json/wp/v2/pages with correct URL and method", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://example.wp.test/wp-json/wp/v2/pages");
      expect((init as RequestInit).method).toBe("POST");
    });

    it("sends Basic Auth header using base64-encoded user:appPassword", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      const [, init] = mockFetch.mock.calls[0]!;
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(EXPECTED_AUTH);
    });

    it("sends Content-Type: application/json and Accept: application/json", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      const [, init] = mockFetch.mock.calls[0]!;
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Accept"]).toBe("application/json");
    });

    it("sends request body with title, slug, content, status:draft, excerpt", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      const [, init] = mockFetch.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.title).toBe("Test Page");
      expect(body.slug).toBe("test-page");
      expect(body.content).toBe(INPUT.content);
      expect(body.status).toBe("draft");
      expect(body.excerpt).toBe(INPUT.meta_description);
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED, retryable:false", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
      expect(result.retryable).toBe(false);
    });

    it("server error (5xx): returns ok:false with code WP_API_ERROR, retryable:true after all retries exhausted", async () => {
      // wpFetch retries up to MAX_RETRIES (3) times on 5xx — mock 4 responses
      mockFetch
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }));

      const result = await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("malformed JSON response (non-JSON body on 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<html>proxy error</html>"));

      const result = await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(false);
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR, retryable:true after all retries exhausted", async () => {
      // wpFetch retries network errors too — mock 4 rejections
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() => wpCreatePage(FAKE_CFG, INPUT));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("trims trailing slashes from baseUrl when constructing URLs", async () => {
      const cfgWithSlash: WpConfig = { ...FAKE_CFG, baseUrl: "https://example.wp.test///" };
      mockFetch.mockResolvedValueOnce(jsonResponse(201, FAKE_WP_PAGE));

      await callAndFlush(() => wpCreatePage(cfgWithSlash, INPUT));

      const [url] = mockFetch.mock.calls[0]!;
      expect(url as string).toBe("https://example.wp.test/wp-json/wp/v2/pages");
    });
  });

  // ---------------------------------------------------------------------------
  // wpListPages
  // ---------------------------------------------------------------------------

  describe("wpListPages", () => {
    const WP_PAGE_LIST = [
      {
        id: 10,
        title: { rendered: "Home" },
        slug: "home",
        status: "publish",
        parent: 0,
        modified_gmt: "2026-04-20T12:00:00Z",
        modified: "2026-04-20T12:00:00Z",
      },
      {
        id: 11,
        title: { rendered: "About" },
        slug: "about",
        status: "draft",
        parent: 10,
        modified_gmt: "2026-04-21T12:00:00Z",
        modified: "2026-04-21T12:00:00Z",
      },
    ];

    it("happy path: returns ok:true with pages array shaped to PageListItem", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_PAGE_LIST));

      const result = await callAndFlush(() => wpListPages(FAKE_CFG, {}));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0]).toMatchObject({
        page_id: 10,
        title: "Home",
        slug: "home",
        status: "publish",
        parent_id: null, // parent:0 → null
        modified_date: "2026-04-20T12:00:00Z",
      });
      expect(result.pages[1]).toMatchObject({
        page_id: 11,
        parent_id: 10, // parent:10 > 0 → preserved
      });
    });

    it("sends GET to /wp-json/wp/v2/pages with status=any by default", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

      await callAndFlush(() => wpListPages(FAKE_CFG, {}));

      const [url, init] = mockFetch.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("GET");
      expect(url as string).toContain("/wp-json/wp/v2/pages");
      expect(url as string).toContain("status=any");
      expect(url as string).toContain("per_page=100");
    });

    it("resolves parent_slug to a parent id via a secondary slug lookup request", async () => {
      // First call: slug resolution
      mockFetch.mockResolvedValueOnce(jsonResponse(200, [{ id: 5 }]));
      // Second call: page list
      mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

      const result = await callAndFlush(() =>
        wpListPages(FAKE_CFG, { parent_slug: "services" }),
      );

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second request should include parent=5
      const [secondUrl] = mockFetch.mock.calls[1]!;
      expect(secondUrl as string).toContain("parent=5");
    });

    it("returns ok:true with empty pages when parent_slug resolves to nothing", async () => {
      // Slug lookup returns empty array → id = null
      mockFetch.mockResolvedValueOnce(jsonResponse(200, []));

      const result = await callAndFlush(() =>
        wpListPages(FAKE_CFG, { parent_slug: "nonexistent" }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.pages).toHaveLength(0);
      // No second fetch — short-circuited on null parent
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() => wpListPages(FAKE_CFG, {}));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR", async () => {
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() => wpListPages(FAKE_CFG, {}));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("malformed JSON (non-JSON 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<html>proxy</html>"));

      const result = await callAndFlush(() => wpListPages(FAKE_CFG, {}));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
    });
  });

  // ---------------------------------------------------------------------------
  // wpGetPage
  // ---------------------------------------------------------------------------

  describe("wpGetPage", () => {
    it("happy path: returns ok:true with page fields correctly mapped", async () => {
      const wpBody = {
        id: 42,
        title: { raw: "My Title", rendered: "My Title" },
        slug: "my-slug",
        status: "publish",
        content: { raw: "<p>Content</p>", rendered: "<p>Content</p>" },
        excerpt: { raw: "Short desc", rendered: "Short desc" },
        parent: 0,
        modified_gmt: "2026-04-24T10:00:00Z",
        modified: "2026-04-24T10:00:00Z",
      };
      mockFetch.mockResolvedValueOnce(jsonResponse(200, wpBody));

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
      expect(result.title).toBe("My Title");
      expect(result.slug).toBe("my-slug");
      expect(result.content).toBe("<p>Content</p>");
      expect(result.meta_description).toBe("Short desc");
      expect(result.status).toBe("publish");
      expect(result.parent_id).toBeNull(); // parent:0 → null
      expect(result.modified_date).toBe("2026-04-24T10:00:00Z");
    });

    it("sends GET to /wp-json/wp/v2/pages/{id}?context=edit", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, FAKE_WP_PAGE));

      await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url as string).toBe(
        "https://example.wp.test/wp-json/wp/v2/pages/42?context=edit",
      );
      expect((init as RequestInit).method).toBe("GET");
    });

    it("404: returns ok:false with code NOT_FOUND, retryable:false", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(404, { code: "rest_post_invalid_id", message: "Invalid post ID.", data: { status: 404 } }),
      );

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 9999));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NOT_FOUND");
      expect(result.retryable).toBe(false);
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
      expect(result.retryable).toBe(false);
    });

    it("server error (5xx): returns ok:false with code WP_API_ERROR, retryable:true", async () => {
      const serverErr = jsonResponse(503, { code: "service_unavailable" });
      mockFetch
        .mockResolvedValueOnce(serverErr)
        .mockResolvedValueOnce(jsonResponse(503, { code: "service_unavailable" }))
        .mockResolvedValueOnce(jsonResponse(503, { code: "service_unavailable" }))
        .mockResolvedValueOnce(jsonResponse(503, { code: "service_unavailable" }));

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR", async () => {
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
    });

    it("malformed JSON (non-JSON 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<html>cache hit</html>"));

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
    });

    it("non-JSON 403 (WAF block): returns ok:false with code UPSTREAM_BLOCKED", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Forbidden by WAF", {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
      );

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("UPSTREAM_BLOCKED");
      expect(result.retryable).toBe(false);
    });

    it("JSON 403 (forbidden JSON): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(403, { code: "rest_forbidden", message: "You are not allowed." }),
      );

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      // 403 with JSON content-type is treated as AUTH_FAILED per mapHttpErrorToWpError
      expect(result.code).toBe("AUTH_FAILED");
    });

    it("429 rate limit: returns ok:false with code RATE_LIMIT, retryable:true", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "content-type": "application/json" } }),
      );

      const result = await callAndFlush(() => wpGetPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("RATE_LIMIT");
      expect(result.retryable).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // wpUpdatePage
  // ---------------------------------------------------------------------------

  describe("wpUpdatePage", () => {
    const WP_UPDATE_RESPONSE = {
      id: 42,
      status: "draft",
      modified_gmt: "2026-04-24T11:00:00Z",
      modified: "2026-04-24T11:00:00Z",
    };

    it("happy path: returns ok:true with page_id, status, modified_date", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_UPDATE_RESPONSE));

      const result = await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { title: "New Title" }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
      expect(result.status).toBe("draft");
      expect(result.modified_date).toBe("2026-04-24T11:00:00Z");
    });

    it("sends POST to /wp-json/wp/v2/pages/{id} with only the provided fields in the body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_UPDATE_RESPONSE));

      await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { title: "Changed", meta_description: "New desc" }),
      );

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url as string).toBe(
        "https://example.wp.test/wp-json/wp/v2/pages/42",
      );
      expect((init as RequestInit).method).toBe("POST");
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.title).toBe("Changed");
      expect(body.excerpt).toBe("New desc"); // meta_description → excerpt
      expect(body.content).toBeUndefined(); // not provided → not sent
    });

    it("maps slug field to 'slug' in the WP body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_UPDATE_RESPONSE));

      await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { slug: "new-slug" }),
      );

      const [, init] = mockFetch.mock.calls[0]!;
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.slug).toBe("new-slug");
    });

    it("404: returns ok:false with code NOT_FOUND", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(404, { code: "rest_post_invalid_id" }),
      );

      const result = await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 9999, { title: "Gone" }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NOT_FOUND");
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { title: "Updated" }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR", async () => {
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { title: "Updated" }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
    });

    it("malformed JSON (non-JSON 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<!doctype html>"));

      const result = await callAndFlush(() =>
        wpUpdatePage(FAKE_CFG, 42, { title: "Updated" }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
    });
  });

  // ---------------------------------------------------------------------------
  // wpPublishPage
  // ---------------------------------------------------------------------------

  describe("wpPublishPage", () => {
    const WP_PUBLISH_RESPONSE = {
      id: 42,
      status: "publish",
      link: "https://example.wp.test/test-page/",
      modified_gmt: "2026-04-24T12:00:00Z",
    };

    it("happy path: returns ok:true with page_id, status:publish, published_url from body.link", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_PUBLISH_RESPONSE));

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
      expect(result.status).toBe("publish");
      expect(result.published_url).toBe("https://example.wp.test/test-page/");
    });

    it("sends POST to /wp-json/wp/v2/pages/{id} with body {status:'publish'}", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_PUBLISH_RESPONSE));

      await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url as string).toBe(
        "https://example.wp.test/wp-json/wp/v2/pages/42",
      );
      expect((init as RequestInit).method).toBe("POST");
      const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>;
      expect(body.status).toBe("publish");
    });

    it("falls back to /?page_id={id} URL when body.link is absent or empty", async () => {
      const responseWithoutLink = { id: 42, status: "publish", link: "" };
      mockFetch.mockResolvedValueOnce(jsonResponse(200, responseWithoutLink));

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.published_url).toBe("https://example.wp.test/?page_id=42");
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
      expect(result.retryable).toBe(false);
    });

    it("server error (5xx): returns ok:false with code WP_API_ERROR, retryable:true", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }));

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("non-retryable WP_API_ERROR for non-5xx non-classified errors (e.g. 422)", async () => {
      // 422 falls through to the generic !res.ok branch → WP_API_ERROR, retryable: res.status >= 500 = false
      mockFetch.mockResolvedValueOnce(
        jsonResponse(422, { code: "rest_invalid_param", message: "Invalid parameter." }),
      );

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(false);
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR", async () => {
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
    });

    it("malformed JSON (non-JSON 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<html>error</html>"));

      const result = await callAndFlush(() => wpPublishPage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
    });
  });

  // ---------------------------------------------------------------------------
  // wpDeletePage
  // ---------------------------------------------------------------------------

  describe("wpDeletePage", () => {
    const WP_DELETE_RESPONSE = {
      id: 42,
      status: "trash",
      previous: { id: 42, status: "publish" },
    };

    it("happy path: returns ok:true with page_id and status:'trash'", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_DELETE_RESPONSE));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
      expect(result.status).toBe("trash");
    });

    it("sends DELETE to /wp-json/wp/v2/pages/{id}", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, WP_DELETE_RESPONSE));

      await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url as string).toBe(
        "https://example.wp.test/wp-json/wp/v2/pages/42",
      );
      expect((init as RequestInit).method).toBe("DELETE");
    });

    it("falls back to previous.id when body.id is missing", async () => {
      // WP sometimes returns the body nested under 'previous' on trash
      const bodyWithoutTopId = { previous: { id: 42 } };
      mockFetch.mockResolvedValueOnce(jsonResponse(200, bodyWithoutTopId));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(42);
    });

    it("falls back to the passed pageId when body has neither id nor previous.id", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 99));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("narrowing");
      expect(result.page_id).toBe(99);
    });

    it("404: returns ok:false with code NOT_FOUND", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(404, { code: "rest_post_invalid_id" }),
      );

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 9999));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NOT_FOUND");
    });

    it("auth failure (401): returns ok:false with code AUTH_FAILED", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(401, WP_401_BODY));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("AUTH_FAILED");
      expect(result.retryable).toBe(false);
    });

    it("server error (5xx): returns ok:false with code WP_API_ERROR, retryable:true", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }))
        .mockResolvedValueOnce(jsonResponse(500, { code: "internal_server_error" }));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
      expect(result.retryable).toBe(true);
    });

    it("network error (fetch rejects): returns ok:false with code NETWORK_ERROR", async () => {
      const netErr = new TypeError("fetch failed");
      mockFetch
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr)
        .mockRejectedValueOnce(netErr);

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("NETWORK_ERROR");
    });

    it("malformed JSON (non-JSON 200): returns ok:false with code WP_API_ERROR", async () => {
      mockFetch.mockResolvedValueOnce(htmlResponse(200, "<html>oops</html>"));

      const result = await callAndFlush(() => wpDeletePage(FAKE_CFG, 42));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("narrowing");
      expect(result.code).toBe("WP_API_ERROR");
    });
  });
});
