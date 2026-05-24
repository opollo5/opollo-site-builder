import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Integration tests for /api/cron/insights-competitor-scrape
// Verifies no-op behavior when APIFY_TOKEN is unset.
// Supabase is mocked to avoid database dependency.
// ---------------------------------------------------------------------------

const mockSvcInsert = vi.fn().mockResolvedValue({ error: null });
const mockSvcFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  }),
  insert: mockSvcInsert,
});

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({ from: mockSvcFrom }),
}));

vi.mock("@/lib/platform/cron/cron-shared", () => ({
  authorisedCronRequest: vi.fn().mockReturnValue(true),
  unauthorisedResponse: vi.fn(),
}));

vi.mock("apify-client", () => ({
  ApifyClient: vi.fn().mockImplementation(() => ({
    actor: vi.fn().mockReturnValue({
      call: vi.fn().mockResolvedValue({ id: "run-mock", status: "SUCCEEDED" }),
    }),
    run: vi.fn().mockReturnValue({
      dataset: vi.fn().mockReturnValue({
        listItems: vi.fn().mockResolvedValue({ items: [] }),
      }),
    }),
  })),
}));

function makeRequest(url = "http://localhost/api/cron/insights-competitor-scrape") {
  return new NextRequest(url, {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

describe("/api/cron/insights-competitor-scrape", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    mockSvcInsert.mockClear();
    mockSvcFrom.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 200 with noop=true when APIFY_TOKEN is unset", async () => {
    delete process.env.APIFY_TOKEN;

    const { GET } = await import("../../app/api/cron/insights-competitor-scrape/route");
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.noop).toBe(true);
    expect(body.reason).toBe("apify_unconfigured");
  });

  it("logs ins_ingest_log with apify_unconfigured note when no-op", async () => {
    delete process.env.APIFY_TOKEN;

    const { GET } = await import("../../app/api/cron/insights-competitor-scrape/route");
    await GET(makeRequest());

    // The ingest log insert should be called
    const insertCalls = mockSvcInsert.mock.calls;
    const logInsert = insertCalls.find((call) => {
      const arg = call[0] as Record<string, unknown>;
      return arg?.cron_route === "/api/cron/insights-competitor-scrape";
    });

    expect(logInsert).toBeDefined();
    const logEntry = logInsert![0] as Record<string, unknown>;
    expect(logEntry.posts_processed).toBe(0);
    const errs = logEntry.errors as Array<Record<string, string>>;
    expect(errs[0]?.note).toBe("apify_unconfigured");
  });

  it("returns 200 with company processing data when token is set but no companies", async () => {
    process.env.APIFY_TOKEN = "test-token";

    // Override consent query to return no companies
    mockSvcFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      insert: mockSvcInsert,
    });

    const { GET } = await import("../../app/api/cron/insights-competitor-scrape/route");
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.companiesProcessed).toBe(0);
  });
});
