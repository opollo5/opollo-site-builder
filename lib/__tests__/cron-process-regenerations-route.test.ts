import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/process-regenerations (M15-6 #8).
//
// Covers: auth guard, no-work tick, succeeded/failed/creds-missing outcomes,
// and 500 error handling. The WP_CREDS_MISSING *terminal failure + DB write*
// is already covered by cron-process-regenerations-wp-creds.test.ts (E2E
// against the real Supabase stack). This file covers the HTTP envelope layer
// with fully mocked worker internals.
// ---------------------------------------------------------------------------

const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockReapExpiredRegenLeases = vi.hoisted(() => vi.fn());
const mockLeaseNextRegenJob = vi.hoisted(() => vi.fn());
const mockProcessRegenJob = vi.hoisted(() => vi.fn());
const mockGetSite = vi.hoisted(() => vi.fn());
const mockWpGetPage = vi.hoisted(() => vi.fn());
const mockWpUpdatePage = vi.hoisted(() => vi.fn());
const mockGetServiceRoleClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@/lib/regeneration-worker", () => ({
  DEFAULT_REGEN_LEASE_MS: 300_000,
  reapExpiredRegenLeases: mockReapExpiredRegenLeases,
  leaseNextRegenJob: mockLeaseNextRegenJob,
  processRegenJob: mockProcessRegenJob,
}));

vi.mock("@/lib/sites", () => ({
  getSite: mockGetSite,
}));

vi.mock("@/lib/wordpress", () => ({
  wpGetPage: mockWpGetPage,
  wpUpdatePage: mockWpUpdatePage,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the dynamic import of @/lib/supabase inside the route's creds-missing branch.
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });
mockGetServiceRoleClient.mockReturnValue({ from: mockFrom });

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: mockGetServiceRoleClient,
}));

import { GET, POST } from "@/app/api/cron/process-regenerations/route";

const VALID_CREDS = {
  wp_user: "admin",
  wp_app_password: "pass",
};

const VALID_SITE = {
  id: "site-1",
  wp_url: "https://wp.test",
  name: "Test",
  status: "active",
};

function makeRequest(method: "GET" | "POST" = "GET", authHeader?: string): Request {
  return new Request("http://localhost/api/cron/process-regenerations", {
    method,
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "a".repeat(32);
  mockConstantTimeEqual.mockReset().mockReturnValue(false);
  mockReapExpiredRegenLeases.mockReset().mockResolvedValue({ reapedCount: 0 });
  mockLeaseNextRegenJob.mockReset().mockResolvedValue(null);
  mockProcessRegenJob.mockReset().mockResolvedValue({ ok: true });
  mockGetSite.mockReset().mockResolvedValue({
    ok: true,
    data: { site: VALID_SITE, credentials: VALID_CREDS },
  });
  mockWpGetPage.mockReset();
  mockWpUpdatePage.mockReset();
  mockFrom.mockClear();
  mockUpdate.mockClear();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — auth", () => {
  it("401 when no authorization header", async () => {
    const res = await GET(makeRequest("GET") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 when header doesn't match", async () => {
    mockConstantTimeEqual.mockReturnValue(false);
    const res = await GET(makeRequest("GET", "Bearer wrong") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it("401 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("GET", "Bearer any") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// No-work tick
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — no-work tick", () => {
  it("200 — returns no-work outcome when queue is empty", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockReapExpiredRegenLeases.mockResolvedValue({ reapedCount: 2 });
    mockLeaseNextRegenJob.mockResolvedValue(null);

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("no-work");
    expect(body.data.reapedCount).toBe(2);
    expect(body.data.processedJobId).toBeNull();
    expect(mockProcessRegenJob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Succeeded outcome
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — succeeded outcome", () => {
  it("200 — returns succeeded when processRegenJob returns ok:true", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextRegenJob.mockResolvedValue({ id: "job-1", site_id: "site-1", page_id: "page-1" });

    // Supabase pages query for slug
    mockGetServiceRoleClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { slug: "my-page" }, error: null }),
          }),
        }),
        update: mockUpdate,
      }),
    });

    mockProcessRegenJob.mockResolvedValue({ ok: true });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("succeeded");
    expect(body.data.processedJobId).toBe("job-1");
  });
});

// ---------------------------------------------------------------------------
// Failed outcome
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — failed outcome", () => {
  it("200 — returns failed when processRegenJob returns ok:false", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextRegenJob.mockResolvedValue({ id: "job-2", site_id: "site-1", page_id: "page-2" });

    mockGetServiceRoleClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: mockUpdate,
      }),
    });

    mockProcessRegenJob.mockResolvedValue({ ok: false, error: { code: "WP_API_ERROR" } });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("failed");
    expect(body.data.processedJobId).toBe("job-2");
  });
});

// ---------------------------------------------------------------------------
// Creds-missing outcome (HTTP envelope; DB-write side-effect tested in E2E suite)
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — creds-missing outcome", () => {
  it("200 — returns creds-missing when getSite has no credentials", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextRegenJob.mockResolvedValue({ id: "job-3", site_id: "site-1", page_id: "page-3" });
    mockGetSite.mockResolvedValue({ ok: true, data: { site: VALID_SITE, credentials: null } });

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
    mockGetServiceRoleClient.mockReturnValue({ from: vi.fn().mockReturnValue({ update: updateFn }) });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("creds-missing");
    expect(body.data.processedJobId).toBe("job-3");
    expect(mockProcessRegenJob).not.toHaveBeenCalled();
  });

  it("200 — returns creds-missing when getSite itself fails", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextRegenJob.mockResolvedValue({ id: "job-4", site_id: "site-1", page_id: "page-4" });
    mockGetSite.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Site not found", retryable: false, suggested_action: "" },
    });

    const eqFn = vi.fn().mockResolvedValue({ error: null });
    const updateFn = vi.fn().mockReturnValue({ eq: eqFn });
    mockGetServiceRoleClient.mockReturnValue({ from: vi.fn().mockReturnValue({ update: updateFn }) });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.outcome).toBe("creds-missing");
  });
});

// ---------------------------------------------------------------------------
// POST symmetry
// ---------------------------------------------------------------------------

describe("POST /api/cron/process-regenerations", () => {
  it("200 — POST also dispatches through handle()", async () => {
    mockConstantTimeEqual.mockReturnValue(true);

    const res = await POST(makeRequest("POST", "Bearer valid") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("401 — POST also checks auth", async () => {
    mockConstantTimeEqual.mockReturnValue(false);

    const res = await POST(makeRequest("POST", "Bearer bad") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-regenerations — error handling", () => {
  it("500 — runTick throws → structured INTERNAL_ERROR response", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockReapExpiredRegenLeases.mockRejectedValue(new Error("Lease reap failed"));

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toContain("Lease reap failed");
    expect(body.error.retryable).toBe(true);
  });
});
