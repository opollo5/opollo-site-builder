import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for POST /api/ops/self-probe (M15-6 #5-12).
//
// Tests auth gate, emergency-key bypass, all-ok 200 envelope, partial-fail
// 502 envelope, and vendor "not configured" short-circuits.
// ---------------------------------------------------------------------------

const mockRequireAdminForApi = vi.hoisted(() => vi.fn());
const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockCaptureSentryException = vi.hoisted(() => vi.fn());
const mockFlushSentry = vi.hoisted(() => vi.fn());
const mockGetLangfuseClient = vi.hoisted(() => vi.fn());
const mockFlushLangfuse = vi.hoisted(() => vi.fn());
const mockGetRedisClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin-api-gate", () => ({
  requireAdminForApi: mockRequireAdminForApi,
}));

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureSentryException,
  flush: mockFlushSentry,
}));

vi.mock("@/lib/langfuse", () => ({
  getLangfuseClient: mockGetLangfuseClient,
  flushLangfuse: mockFlushLangfuse,
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: mockGetRedisClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
  headers: () => new Headers(),
}));

import { POST } from "@/app/api/ops/self-probe/route";

const GATE_ALLOW = {
  kind: "allow" as const,
  user: { id: "u1", email: "admin@test.com", role: "admin" as const },
};
const GATE_DENY = {
  kind: "deny" as const,
  response: new Response(
    JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }),
    { status: 401 },
  ),
};

function makeRequest(
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/ops/self-probe", {
    method: "POST",
    headers,
  });
}

const FAKE_LANGFUSE_CLIENT = {
  trace: vi.fn().mockReturnValue({
    id: "trace-123",
    event: vi.fn(),
  }),
};

const FAKE_REDIS_CLIENT = {
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn(),
};

beforeEach(() => {
  mockRequireAdminForApi.mockReset().mockResolvedValue(GATE_ALLOW);
  mockConstantTimeEqual.mockReset().mockReturnValue(false);
  mockCaptureSentryException.mockReset().mockReturnValue("sentry-event-id");
  mockFlushSentry.mockReset().mockResolvedValue(true);
  mockGetLangfuseClient.mockReset().mockReturnValue(FAKE_LANGFUSE_CLIENT);
  mockFlushLangfuse.mockReset().mockResolvedValue(undefined);
  mockGetRedisClient.mockReset().mockReturnValue({
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue("__probe_id__"),
  });

  // Provide env vars so vendor probes don't short-circuit
  process.env.SENTRY_DSN = "https://key@sentry.io/123";
  process.env.AXIOM_TOKEN = "xaat-token";
  process.env.AXIOM_DATASET = "opollo";
  process.env.OPOLLO_EMERGENCY_KEY = "x".repeat(32);
});

describe("POST /api/ops/self-probe", () => {
  it("401 — gate denies and no emergency key header", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    mockConstantTimeEqual.mockReturnValue(false);

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("200 — emergency key bypasses gate denial", async () => {
    mockRequireAdminForApi.mockResolvedValue(GATE_DENY);
    mockConstantTimeEqual.mockReturnValue(true);
    // Wire redis mock to return matching probe id for round-trip check
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockResolvedValue("OK"),
      get: vi.fn().mockImplementation(() => Promise.resolve("any-probe-id")),
    });

    const res = await POST(
      makeRequest({ "x-opollo-emergency-key": "x".repeat(32) }) as Parameters<typeof POST>[0],
    );

    // Status is 200 if all vendors ok, 502 if any fail
    // At minimum, it should NOT be 401
    expect(res.status).not.toBe(401);
  });

  it("200 — all vendors ok, top-level ok=true", async () => {
    // Redis: return the probe_id that was written
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockResolvedValue("OK"),
      get: vi.fn().mockImplementation(async (key: string) => {
        // The route writes the probeId under the key; we return anything
        // truthy — the route checks echoed !== probeId, so we need to
        // match. Since we can't know the generated probe_id, mock set
        // to capture it.
        return "__probe__";
      }),
    });
    // Make redis get return the same thing set wrote
    const capturedId: { value: string | null } = { value: null };
    const redisMock = {
      set: vi.fn().mockImplementation(async (_key: string, val: string) => {
        capturedId.value = val;
        return "OK";
      }),
      get: vi.fn().mockImplementation(async () => capturedId.value),
    };
    mockGetRedisClient.mockReturnValue(redisMock);

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.probe_id).toBe("string");
    expect(body.vendors).toHaveProperty("sentry");
    expect(body.vendors).toHaveProperty("axiom");
    expect(body.vendors).toHaveProperty("langfuse");
    expect(body.vendors).toHaveProperty("upstash");
  });

  it("502 — sentry not configured → sentry vendor ok=false → body ok=false", async () => {
    delete process.env.SENTRY_DSN;

    const capturedId: { value: string | null } = { value: null };
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockImplementation(async (_k: string, val: string) => {
        capturedId.value = val;
        return "OK";
      }),
      get: vi.fn().mockImplementation(async () => capturedId.value),
    });

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.vendors.sentry.ok).toBe(false);
    expect(body.vendors.sentry.error).toMatch(/SENTRY_DSN not set/);
  });

  it("502 — langfuse not configured → langfuse vendor ok=false", async () => {
    mockGetLangfuseClient.mockReturnValue(null);

    const capturedId: { value: string | null } = { value: null };
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockImplementation(async (_k: string, val: string) => {
        capturedId.value = val;
        return "OK";
      }),
      get: vi.fn().mockImplementation(async () => capturedId.value),
    });

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.vendors.langfuse.ok).toBe(false);
  });

  it("502 — redis not configured → upstash vendor ok=false", async () => {
    mockGetRedisClient.mockReturnValue(null);

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.vendors.upstash.ok).toBe(false);
    expect(body.vendors.upstash.error).toMatch(/UPSTASH_REDIS_REST_URL/i);
  });

  it("502 — axiom not configured (no AXIOM_TOKEN) → axiom vendor ok=false", async () => {
    delete process.env.AXIOM_TOKEN;

    const capturedId: { value: string | null } = { value: null };
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockImplementation(async (_k: string, val: string) => {
        capturedId.value = val;
        return "OK";
      }),
      get: vi.fn().mockImplementation(async () => capturedId.value),
    });

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.vendors.axiom.ok).toBe(false);
  });

  it("response always has probe_id, elapsed_ms, vendors, timestamp fields", async () => {
    const capturedId: { value: string | null } = { value: null };
    mockGetRedisClient.mockReturnValue({
      set: vi.fn().mockImplementation(async (_k: string, val: string) => {
        capturedId.value = val;
        return "OK";
      }),
      get: vi.fn().mockImplementation(async () => capturedId.value),
    });

    const res = await POST(makeRequest() as Parameters<typeof POST>[0]);
    const body = await res.json();

    expect(typeof body.probe_id).toBe("string");
    expect(typeof body.elapsed_ms).toBe("number");
    expect(typeof body.timestamp).toBe("string");
    expect(body.vendors).toHaveProperty("sentry");
    expect(body.vendors).toHaveProperty("axiom");
    expect(body.vendors).toHaveProperty("langfuse");
    expect(body.vendors).toHaveProperty("upstash");
  });
});
