import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectSeoPlugins,
  fingerprintFromNamespaces,
} from "@/lib/seo-plugin-detection";
import type { WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-2 — SEO plugin detection unit tests.
//
// Split across:
//
//   1. fingerprintFromNamespaces — pure-function table tests; no fetch.
//      Covers the priority rules (yoast > rank-math > seopress), the
//      "nothing detected" path, the "multiple detected" path, and the
//      robustness of the matcher against variant namespace shapes.
//
//   2. detectSeoPlugins — integration with the /wp-json/ endpoint.
//      Stubbed fetch. Covers the happy path, the 401/403 AUTH_FAILED
//      path, the 404 NOT_FOUND ("is /wp-json/ exposed?") path, a 5xx
//      WP_API_ERROR, and a malformed body.
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FAKE_CFG: WpConfig = {
  baseUrl: "https://example.wp.test",
  user: "admin",
  appPassword: "xxxx yyyy zzzz",
};

const EXPECTED_AUTH =
  "Basic " + Buffer.from("admin:xxxx yyyy zzzz").toString("base64");

// ---------------------------------------------------------------------------
// fingerprintFromNamespaces — pure-function tests
// ---------------------------------------------------------------------------

describe("fingerprintFromNamespaces", () => {
  it("returns nothing when no SEO namespace is present", () => {
    const result = fingerprintFromNamespaces([
      "oembed/1.0",
      "wp/v2",
      "wp-block-editor/v1",
    ]);
    expect(result.plugin).toBeNull();
    expect(result.allDetected).toEqual([]);
  });

  it("detects Yoast SEO from `yoast/v1`", () => {
    const result = fingerprintFromNamespaces(["wp/v2", "yoast/v1"]);
    expect(result.plugin).not.toBeNull();
    expect(result.plugin?.name).toBe("yoast");
    expect(result.plugin?.displayName).toBe("Yoast SEO");
    expect(result.plugin?.namespace).toBe("yoast/v1");
    expect(result.allDetected).toHaveLength(1);
  });

  it("detects Rank Math from `rankmath/v1`", () => {
    const result = fingerprintFromNamespaces(["wp/v2", "rankmath/v1"]);
    expect(result.plugin?.name).toBe("rank-math");
    expect(result.plugin?.displayName).toBe("Rank Math");
    expect(result.plugin?.namespace).toBe("rankmath/v1");
  });

  it("detects SEOPress from `seopress/v1`", () => {
    const result = fingerprintFromNamespaces(["wp/v2", "seopress/v1"]);
    expect(result.plugin?.name).toBe("seopress");
    expect(result.plugin?.displayName).toBe("SEOPress");
    expect(result.plugin?.namespace).toBe("seopress/v1");
  });

  it("picks Yoast over Rank Math when both are present (priority order)", () => {
    const result = fingerprintFromNamespaces([
      "wp/v2",
      "rankmath/v1",
      "yoast/v1",
    ]);
    expect(result.plugin?.name).toBe("yoast");
    expect(result.allDetected.map((p) => p.name)).toEqual([
      "yoast",
      "rank-math",
    ]);
  });

  it("picks Rank Math over SEOPress when Yoast is absent", () => {
    const result = fingerprintFromNamespaces([
      "wp/v2",
      "seopress/v1",
      "rankmath/v1",
    ]);
    expect(result.plugin?.name).toBe("rank-math");
    expect(result.allDetected.map((p) => p.name)).toEqual([
      "rank-math",
      "seopress",
    ]);
  });

  it("lists all three in allDetected when all three are present", () => {
    const result = fingerprintFromNamespaces([
      "yoast/v1",
      "rankmath/v1",
      "seopress/v1",
    ]);
    expect(result.plugin?.name).toBe("yoast");
    expect(result.allDetected.map((p) => p.name)).toEqual([
      "yoast",
      "rank-math",
      "seopress",
    ]);
  });

  it("accepts variant Yoast namespaces (e.g. `yoast/v2`)", () => {
    const result = fingerprintFromNamespaces(["yoast/v2"]);
    expect(result.plugin?.name).toBe("yoast");
    expect(result.plugin?.namespace).toBe("yoast/v2");
  });

  it("ignores non-string entries in the namespaces array (defensive)", () => {
    // The function accepts `readonly unknown[]` precisely so a noisy
    // /wp-json/ response with a mis-typed entry can't crash detection.
    const result = fingerprintFromNamespaces([
      "wp/v2",
      null,
      42,
      "yoast/v1",
    ]);
    expect(result.plugin?.name).toBe("yoast");
  });
});

// ---------------------------------------------------------------------------
// detectSeoPlugins — integration with /wp-json/
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectSeoPlugins", () => {
  it("happy path: returns plugin=yoast when /wp-json/ lists yoast/v1", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        name: "Test Site",
        namespaces: ["oembed/1.0", "wp/v2", "yoast/v1"],
      }),
    );
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.plugin?.name).toBe("yoast");
    expect(result.namespaces).toContain("yoast/v1");
  });

  it("GETs /wp-json/ with Basic Auth header", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { namespaces: ["wp/v2"] }),
    );
    await detectSeoPlugins(FAKE_CFG);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://example.wp.test/wp-json/");
    expect((init as RequestInit).method).toBe("GET");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(EXPECTED_AUTH);
  });

  it("returns plugin=null when namespaces list no SEO plugin", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { namespaces: ["oembed/1.0", "wp/v2"] }),
    );
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.plugin).toBeNull();
    expect(result.allDetected).toEqual([]);
  });

  it("401 returns AUTH_FAILED", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(401, { code: "rest_forbidden", message: "nope" }),
    );
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("AUTH_FAILED");
  });

  it("403 returns AUTH_FAILED", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(403, { code: "rest_forbidden", message: "nope" }),
    );
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("AUTH_FAILED");
  });

  it("404 returns NOT_FOUND (REST API not exposed)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, {}));
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NOT_FOUND");
    expect(result.suggested_action).toMatch(/permalinks/i);
  });

  it("5xx returns WP_API_ERROR (retryable:true)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(502, {}));
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("WP_API_ERROR");
    expect(result.retryable).toBe(true);
  });

  it("network failure returns NETWORK_ERROR", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("narrowing");
    expect(result.code).toBe("NETWORK_ERROR");
  });

  it("response body without a `namespaces` array returns plugin=null with empty namespaces", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { name: "Weird site" }),
    );
    const result = await detectSeoPlugins(FAKE_CFG);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("narrowing");
    expect(result.plugin).toBeNull();
    expect(result.namespaces).toEqual([]);
  });
});
