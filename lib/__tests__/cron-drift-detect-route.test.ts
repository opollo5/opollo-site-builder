import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/drift-detect (M16-8).
// Covers: auth guard, no-sites no-op, per-site drift run, DB lookup error,
// and uncaught exception path.
// ---------------------------------------------------------------------------

const mockRunDriftDetector = vi.hoisted(() => vi.fn());
const mockGetSite = vi.hoisted(() => vi.fn());
const mockGetServiceRoleClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/drift-detector", () => ({
  runDriftDetector: mockRunDriftDetector,
}));

vi.mock("@/lib/sites", () => ({
  getSite: mockGetSite,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: mockGetServiceRoleClient,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/cron/drift-detect/route";

const CRON_SECRET = "a".repeat(32);
const SITE_UUID = "11111111-1111-1111-1111-111111111111";

// Supabase query chain mock
let mockSelect: ReturnType<typeof vi.fn>;
let mockIn: ReturnType<typeof vi.fn>;
let mockNot: ReturnType<typeof vi.fn>;
let mockFrom: ReturnType<typeof vi.fn>;

function buildSvcMock(rows: unknown[], error: unknown = null) {
  mockNot = vi.fn().mockResolvedValue({ data: rows, error });
  mockIn = vi.fn().mockReturnValue({ not: mockNot });
  mockSelect = vi.fn().mockReturnValue({ in: mockIn });
  mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  mockGetServiceRoleClient.mockReturnValue({ from: mockFrom });
}

function makeRequest(
  method: "GET" | "POST" = "GET",
  secret: string = CRON_SECRET,
): Request {
  return new Request("http://localhost/api/cron/drift-detect", {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  buildSvcMock([]);
  mockGetSite.mockReset();
  mockRunDriftDetector.mockReset().mockResolvedValue({ ok: true, checked: 3, drifted: 0, errors: 0 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/drift-detect — auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/cron/drift-detect");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when bearer token is wrong", async () => {
    const res = await GET(makeRequest("GET", "wrong-secret") as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET env var is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/drift-detect — no published pages", () => {
  it("returns 200 with empty sites array when no published pages found", async () => {
    buildSvcMock([]);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sites).toEqual([]);
  });
});

describe("GET /api/cron/drift-detect — DB lookup error", () => {
  it("returns 500 when pages lookup fails", async () => {
    buildSvcMock([], { message: "db error", code: "PGRST" });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.retryable).toBe(true);
  });
});

describe("GET /api/cron/drift-detect — happy path", () => {
  it("skips site with no credentials", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    mockGetSite.mockResolvedValue({ ok: true, data: { site: { id: SITE_UUID, wp_url: "https://wp.test" }, credentials: null } });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    expect(mockRunDriftDetector).not.toHaveBeenCalled();
  });

  it("runs drift detector for site with credentials", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    mockGetSite.mockResolvedValue({
      ok: true,
      data: {
        site: { id: SITE_UUID, wp_url: "https://wp.test" },
        credentials: { wp_user: "admin", wp_app_password: "pass" },
      },
    });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    expect(mockRunDriftDetector).toHaveBeenCalledWith(
      SITE_UUID,
      expect.objectContaining({ baseUrl: "https://wp.test" }),
    );
    const body = await res.json();
    expect(body.data.sites).toHaveLength(1);
    expect(body.data.sites[0].checked).toBe(3);
  });

  it("deduplicates site_ids from multiple page rows", async () => {
    buildSvcMock([{ site_id: SITE_UUID }, { site_id: SITE_UUID }]);
    mockGetSite.mockResolvedValue({
      ok: true,
      data: {
        site: { id: SITE_UUID, wp_url: "https://wp.test" },
        credentials: { wp_user: "admin", wp_app_password: "pass" },
      },
    });
    await GET(makeRequest() as never);
    expect(mockRunDriftDetector).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/cron/drift-detect", () => {
  it("accepts POST in addition to GET", async () => {
    buildSvcMock([]);
    const res = await POST(makeRequest("POST") as never);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cron/drift-detect — uncaught exception", () => {
  it("returns 500 when runDriftDetector throws", async () => {
    buildSvcMock([{ site_id: SITE_UUID }]);
    mockGetSite.mockResolvedValue({
      ok: true,
      data: {
        site: { id: SITE_UUID, wp_url: "https://wp.test" },
        credentials: { wp_user: "admin", wp_app_password: "pass" },
      },
    });
    mockRunDriftDetector.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("boom");
  });
});
