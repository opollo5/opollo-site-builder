import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Phase 4.2 — POST /api/platform/social/link-preview unit tests.
//
// Covers:
//  - Validation: missing / bad company_id, missing / non-absolute url
//  - Auth gate deny
//  - Redis cache hit → returns cached data without fetching
//  - Fetch timeout → ok:false + TIMEOUT code
//  - Fetch non-HTML content-type → ok:true with url as title
//  - Successful OG extraction (og:title, og:description, og:image)
//  - Fallback to <title> when og:title absent
//  - Fallback to meta description when og:description absent
//  - Graceful ok:false when upstream returns non-200
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn().mockResolvedValue({ kind: "allow" }),
}));

const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue("OK");
vi.mock("@/lib/redis", () => ({
  getRedisClient: () => ({ get: mockRedisGet, set: mockRedisSet }),
}));

// assertSafeUrl does a live DNS lookup; mock it as pass-through here so
// unit tests don't require network access. SSRF blocking is covered by
// tests/regressions/di-006-link-preview-ssrf.test.ts.
vi.mock("@/lib/ssrf-guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ssrf-guard")>();
  return { ...orig, assertSafeUrl: vi.fn().mockResolvedValue({ resolvedIp: "93.184.216.34", family: 4 }) };
});

import { POST } from "@/app/api/platform/social/link-preview/route";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";

const VALID_COMPANY = "12345678-1234-1234-1234-123456789abc";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/platform/social/link-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(requireCanDoForApi).mockResolvedValue({ kind: "allow" } as Awaited<ReturnType<typeof requireCanDoForApi>>);
  mockRedisGet.mockReset().mockResolvedValue(null);
  mockRedisSet.mockReset().mockResolvedValue("OK");
});

describe("POST /api/platform/social/link-preview — validation", () => {
  it("returns 400 when company_id is missing", async () => {
    const res = await POST(makeReq({ url: "https://example.com" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when company_id is not a UUID", async () => {
    const res = await POST(makeReq({ company_id: "not-a-uuid", url: "https://example.com" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when url is missing", async () => {
    const res = await POST(makeReq({ company_id: VALID_COMPANY }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when url is not absolute", async () => {
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "/relative-path" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when url uses non-http protocol", async () => {
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "ftp://example.com" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/platform/social/link-preview — auth", () => {
  it("returns the deny response when gate denies", async () => {
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ ok: false }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireCanDoForApi>>);
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/platform/social/link-preview — Redis cache hit", () => {
  it("returns cached data without fetching", async () => {
    const cached = {
      title: "Cached Title",
      description: null,
      image_url: null,
      domain: "example.com",
      fetched_at: "2026-05-20T00:00:00.000Z",
    };
    mockRedisGet.mockResolvedValueOnce(cached);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; data: typeof cached };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.title).toBe("Cached Title");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/platform/social/link-preview — fetch failures", () => {
  it("returns ok:false with TIMEOUT code on AbortError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
      const err = new DOMException("timeout", "AbortError");
      return Promise.reject(err);
    });
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("TIMEOUT");
  });

  it("returns ok:false with FETCH_FAILED code on non-200 upstream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; error: { code: string } };
    expect(res.status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("FETCH_FAILED");
  });

  it("returns ok:true with url as title for non-HTML content type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com/doc.pdf" }));
    const json = await res.json() as { ok: boolean; data: { title: string } };
    expect(json.ok).toBe(true);
    expect(json.data.title).toBe("https://example.com/doc.pdf");
  });
});

describe("POST /api/platform/social/link-preview — OG extraction", () => {
  const OG_HTML = `<!doctype html>
<html>
<head>
<meta property="og:title" content="OG Title" />
<meta property="og:description" content="OG Description" />
<meta property="og:image" content="https://example.com/og.jpg" />
</head>
<body></body>
</html>`;

  it("extracts og:title, og:description, og:image", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(htmlResponse(OG_HTML));
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; data: { title: string; description: string; image_url: string; domain: string } };
    expect(json.ok).toBe(true);
    expect(json.data.title).toBe("OG Title");
    expect(json.data.description).toBe("OG Description");
    expect(json.data.image_url).toBe("https://example.com/og.jpg");
    expect(json.data.domain).toBe("example.com");
  });

  it("falls back to <title> when og:title is absent", async () => {
    const html = `<html><head><title>Page Title</title></head></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(htmlResponse(html));
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; data: { title: string } };
    expect(json.data.title).toBe("Page Title");
  });

  it("falls back to meta description when og:description is absent", async () => {
    const html = `<html><head><title>T</title><meta name="description" content="Meta desc" /></head></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(htmlResponse(html));
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { ok: boolean; data: { description: string } };
    expect(json.data.description).toBe("Meta desc");
  });

  it("stores result in Redis after successful fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(htmlResponse(OG_HTML));
    await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [, cachedData] = mockRedisSet.mock.calls[0] as [string, unknown];
    expect((cachedData as { title: string }).title).toBe("OG Title");
  });

  it("includes fetched_at ISO timestamp in response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(htmlResponse(OG_HTML));
    const res = await POST(makeReq({ company_id: VALID_COMPANY, url: "https://example.com" }));
    const json = await res.json() as { data: { fetched_at: string } };
    expect(() => new Date(json.data.fetched_at)).not.toThrow();
    expect(new Date(json.data.fetched_at).toISOString()).toBe(json.data.fetched_at);
  });
});
