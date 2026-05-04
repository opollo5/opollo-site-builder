import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/render-pages (M16-7).
// Covers: auth guard, no-stale-pages no-op, per-site render, DB lookup
// error, and uncaught exception path.
// ---------------------------------------------------------------------------

const mockRunRenderWorker = vi.hoisted(() => vi.fn());
const mockGetServiceRoleClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/render-worker", () => ({
  runRenderWorker: mockRunRenderWorker,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/cron/render-pages/route";

const CRON_SECRET = "b".repeat(32);
const SITE_UUID = "11111111-1111-1111-1111-111111111111";

let mockEq: ReturnType<typeof vi.fn>;
let mockIs: ReturnType<typeof vi.fn>;
let mockSelect: ReturnType<typeof vi.fn>;
let mockFrom: ReturnType<typeof vi.fn>;

function buildSvcMock(rows: unknown[], error: unknown = null) {
  mockIs = vi.fn().mockResolvedValue({ data: rows, error });
  mockEq = vi.fn().mockReturnValue({ is: mockIs });
  mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  mockGetServiceRoleClient.mockReturnValue({ from: mockFrom });
}

function makeRequest(
  method: "GET" | "POST" = "GET",
  secret: string = CRON_SECRET,
): Request {
  return new Request("http://localhost/api/cron/render-pages", {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  buildSvcMock([]);
  mockRunRenderWorker.mockReset().mockResolvedValue({ ok: true, rendered: 2, errors: 0 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/render-pages — auth", () => {
  it("returns 401 when no Authorization header", async () => {
    const req = new Request("http://localhost/api/cron/render-pages");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for wrong bearer token", async () => {
    const res = await GET(makeRequest("GET", "wrong") as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET env var is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/render-pages — no stale pages", () => {
  it("returns 200 with empty sites when no stale pages found", async () => {
    buildSvcMock([]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sites).toEqual([]);
  });
});

describe("GET /api/cron/render-pages — DB lookup error", () => {
  it("returns 500 when stale-page lookup fails", async () => {
    buildSvcMock([], { message: "db error" });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.retryable).toBe(true);
  });
});

describe("GET /api/cron/render-pages — happy path", () => {
  it("calls runRenderWorker for each unique site", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    expect(mockRunRenderWorker).toHaveBeenCalledWith({ siteId: SITE_UUID });
    const body = await res.json();
    expect(body.data.sites).toHaveLength(1);
    expect(body.data.sites[0].rendered).toBe(2);
  });

  it("deduplicates site_ids from multiple stale rows", async () => {
    buildSvcMock([{ site_id: SITE_UUID }, { site_id: SITE_UUID }]);
    await GET(makeRequest() as never);
    expect(mockRunRenderWorker).toHaveBeenCalledTimes(1);
  });

  it("counts errors when runRenderWorker returns ok: false", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    mockRunRenderWorker.mockResolvedValue({ ok: false, error: "timeout" });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sites[0].errors).toBe(1);
    expect(body.data.sites[0].rendered).toBe(0);
  });
});

describe("POST /api/cron/render-pages", () => {
  it("accepts POST as well as GET", async () => {
    buildSvcMock([]);
    const res = await POST(makeRequest("POST") as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cron/render-pages — uncaught exception", () => {
  it("returns 500 with retryable: true on thrown error", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    mockRunRenderWorker.mockRejectedValue(new Error("worker crashed"));
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toBe("worker crashed");
    expect(body.error.retryable).toBe(true);
  });
});
