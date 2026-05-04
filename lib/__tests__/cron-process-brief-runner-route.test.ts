import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/process-brief-runner (M12-6).
// Covers: auth guard, nothing_queued no-op, happy path tick, and
// uncaught exception path.
// ---------------------------------------------------------------------------

const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockProcessBriefRunTick = vi.hoisted(() => vi.fn());
const mockReapExpiredBriefRuns = vi.hoisted(() => vi.fn());
const mockDummyAnthropicCall = vi.hoisted(() => vi.fn());
const mockDummyVisualRender = vi.hoisted(() => vi.fn());
const mockGetServiceRoleClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@/lib/brief-runner", () => ({
  processBriefRunTick: mockProcessBriefRunTick,
  reapExpiredBriefRuns: mockReapExpiredBriefRuns,
}));

vi.mock("@/lib/brief-runner-dummy", () => ({
  dummyAnthropicCall: mockDummyAnthropicCall,
  dummyVisualRender: mockDummyVisualRender,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/cron/process-brief-runner/route";

const RUN_UUID = "11111111-1111-1111-1111-111111111111";

// Supabase query chain for brief_runs lookup
let mockMaybeSingle: ReturnType<typeof vi.fn>;
let mockLimit: ReturnType<typeof vi.fn>;
let mockOrder: ReturnType<typeof vi.fn>;
let mockEq: ReturnType<typeof vi.fn>;
let mockSelect: ReturnType<typeof vi.fn>;
let mockFrom: ReturnType<typeof vi.fn>;

function buildSvcMock(data: unknown, error: unknown = null) {
  mockMaybeSingle = vi.fn().mockResolvedValue({ data, error });
  mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
  mockEq = vi.fn().mockReturnValue({ order: mockOrder });
  mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  mockGetServiceRoleClient.mockReturnValue({ from: mockFrom });
}

function makeAuthorisedRequest(method: "GET" | "POST" = "GET"): Request {
  return new Request("http://localhost/api/cron/process-brief-runner", {
    method,
    headers: { authorization: "Bearer valid-cron-secret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "a".repeat(32);
  // constantTimeEqual returns true (authorised) by default
  mockConstantTimeEqual.mockReset().mockReturnValue(true);
  buildSvcMock(null);
  mockProcessBriefRunTick.mockReset().mockResolvedValue({ ok: true, outcome: "succeeded" });
  mockReapExpiredBriefRuns.mockReset().mockResolvedValue({ reapedCount: 0 });
  // Remove SUPABASE_DB_URL so reap path is skipped in unit tests
  delete process.env.SUPABASE_DB_URL;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/process-brief-runner — auth", () => {
  it("returns 401 when constantTimeEqual returns false", async () => {
    mockConstantTimeEqual.mockReturnValue(false);
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/process-brief-runner — nothing queued", () => {
  it("returns 200 with outcome=nothing_queued when no queued run found", async () => {
    buildSvcMock(null);
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("nothing_queued");
    expect(body.data.processedRunId).toBeNull();
    expect(mockProcessBriefRunTick).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/process-brief-runner — happy path", () => {
  it("picks the queued run and calls processBriefRunTick", async () => {
    buildSvcMock({ id: RUN_UUID });
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(200);
    expect(mockProcessBriefRunTick).toHaveBeenCalledWith(
      RUN_UUID,
      expect.objectContaining({ workerId: expect.any(String) }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.processedRunId).toBe(RUN_UUID);
    expect(body.data.outcome).toBe("succeeded");
  });

  it("returns the error code from a failed tick as outcome", async () => {
    buildSvcMock({ id: RUN_UUID });
    mockProcessBriefRunTick.mockResolvedValue({
      ok: false,
      code: "LEASE_STOLEN",
    });
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.outcome).toBe("LEASE_STOLEN");
  });
});

describe("GET /api/cron/process-brief-runner — DB lookup error", () => {
  it("returns 200 with null outcome when brief_runs lookup fails", async () => {
    buildSvcMock(null, { message: "db down" });
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processedRunId).toBeNull();
    expect(body.data.outcome).toBeNull();
  });
});

describe("POST /api/cron/process-brief-runner", () => {
  it("accepts POST in addition to GET", async () => {
    buildSvcMock(null);
    const res = await POST(makeAuthorisedRequest("POST") as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cron/process-brief-runner — uncaught exception", () => {
  it("returns 500 with retryable: true on thrown error", async () => {
    buildSvcMock({ id: RUN_UUID });
    mockProcessBriefRunTick.mockRejectedValue(new Error("crash"));
    const res = await GET(makeAuthorisedRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.retryable).toBe(true);
    expect(body.error.message).toContain("crash");
  });
});
