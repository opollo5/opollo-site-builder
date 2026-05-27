import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DI-006 — Link-preview endpoint fetches arbitrary URLs without SSRF guard.
//
// POST /api/platform/social/link-preview only checked the protocol (http/https)
// before calling fetch(). No check against private/loopback/cloud-metadata IPs.
// A user with edit_post permission could probe 169.254.169.254 or 10.x services.
//
// The existing SSRF guard (lib/ssrf-guard.ts) is used by fetch-url route but
// was not wired into link-preview.
//
// Invariants:
//   1. Returns 400 for a private-IP URL (10.x).
//   2. Returns 400 for the AWS metadata IP (169.254.169.254).
//   3. Returns 400 for localhost.
//   4. Does not reject a normal public URL (assertSafeUrl resolves successfully).
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn(async () => ({ kind: "allow", userId: "user-1" })),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn(() => null),
}));

// Stub assertSafeUrl so we can test the route integration without real DNS.
vi.mock("@/lib/ssrf-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssrf-guard")>();
  return {
    ...actual,
    assertSafeUrl: vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const host = parsed.hostname;
      // Simulate SSRF block for private ranges
      if (
        host === "localhost" ||
        host.startsWith("10.") ||
        host === "169.254.169.254" ||
        host === "127.0.0.1"
      ) {
        throw new actual.SsrfBlockedError(
          `Blocked: ${host}`,
          "ip_blocked",
          { hostname: host },
        );
      }
      return { resolvedIp: "93.184.216.34", family: 4 as const };
    }),
  };
});

const COMPANY_ID = "cccccccc-0000-4000-8000-000000000003";

afterEach(() => vi.clearAllMocks());

async function callLinkPreview(url: string) {
  const { POST } = await import("@/app/api/platform/social/link-preview/route");
  const req = new Request("http://localhost/api/platform/social/link-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: COMPANY_ID, url }),
  });
  return POST(req as never);
}

describe("POST /api/platform/social/link-preview — SSRF guard (DI-006)", () => {
  it("returns 400 for a private 10.x IP URL", async () => {
    const res = await callLinkPreview("http://10.0.0.1/internal");
    expect(res.status).toBe(400);
  });

  it("returns 400 for the AWS metadata endpoint", async () => {
    const res = await callLinkPreview("http://169.254.169.254/latest/meta-data/");
    expect(res.status).toBe(400);
  });

  it("returns 400 for localhost", async () => {
    const res = await callLinkPreview("http://localhost/admin");
    expect(res.status).toBe(400);
  });

  it("does not block a normal public URL (assertSafeUrl resolves)", async () => {
    // Stub fetch to avoid network in tests.
    const fetchStub = vi.fn(async () =>
      new Response("<html><head><title>Example</title></head></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const res = await callLinkPreview("https://example.com");
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });
});
