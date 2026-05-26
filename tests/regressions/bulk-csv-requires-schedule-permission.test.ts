// ---------------------------------------------------------------------------
// REGRESSION — DI-003: bulk CSV upload must require schedule_post permission
//
// Bug: POST /api/platform/social/drafts/bulk checked create_post (editor+)
// but inserts ALL rows with state='scheduled'. An editor-role user could
// bypass the scheduling permission gate by uploading a CSV.
//
// Fix: gate now checks schedule_post (approver+).
//
// Also covers G8: rows that resolve to zero target channels must be rejected
// with 400 UNRESOLVABLE_CHANNELS rather than producing a stuck-scheduled row.
//
// Layer 1 — unit, mocked dependencies. No real Supabase needed.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONNECTION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// Mocks are hoisted to the top of the module so vi.mock factories can reference them.
const mocks = vi.hoisted(() => ({
  requireCanDoForApi: vi.fn(),
  checkPlatformRateLimit: vi.fn(),
  insertDrafts: vi.fn(),
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mocks.requireCanDoForApi,
}));

vi.mock("@/lib/platform/rate-limit", () => ({
  checkPlatformRateLimit: mocks.checkPlatformRateLimit,
  platformRateLimitExceeded: () =>
    new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }), { status: 429 }),
  platformRateLimitUnavailable: () =>
    new Response(JSON.stringify({ ok: false, error: { code: "UNAVAILABLE" } }), { status: 503 }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              is: () =>
                Promise.resolve({
                  data: [{ id: CONNECTION_ID, platform: "linkedin" }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "social_post_drafts") {
        return { insert: mocks.insertDrafts };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/platform/social/drafts/bulk/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid CSV string with a future date. */
function buildCsv(channelColumn = "linkedin"): string {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 1);
  const mm = String(futureDate.getMonth() + 1).padStart(2, "0");
  const dd = String(futureDate.getDate()).padStart(2, "0");
  const yyyy = String(futureDate.getFullYear());
  return `Content,Date,Time,Channel\nHello world,${mm}/${dd}/${yyyy},10:00,${channelColumn}`;
}

function makeRequest(csv: string): Request {
  const formData = new FormData();
  formData.append("file", new Blob([csv], { type: "text/csv" }), "posts.csv");
  return new Request(
    `http://localhost/api/platform/social/drafts/bulk?company_id=${COMPANY_ID}`,
    { method: "POST", body: formData },
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mocks.requireCanDoForApi.mockReset();
  mocks.checkPlatformRateLimit.mockReset();
  mocks.insertDrafts.mockReset();

  // Default: rate limit passes.
  mocks.checkPlatformRateLimit.mockResolvedValue({ ok: true });

  // Default: DB insert succeeds.
  mocks.insertDrafts.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// DI-003: permission gate must be schedule_post
// ---------------------------------------------------------------------------

describe("DI-003 REGRESSION: bulk CSV endpoint requires schedule_post permission", () => {
  it("returns 403 when requireCanDoForApi denies schedule_post (editor-role user)", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "deny",
      response: new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }),
        { status: 403 },
      ),
    });

    const res = await POST(makeRequest(buildCsv()) as never);
    expect(res.status).toBe(403);
  });

  it("calls requireCanDoForApi with action='schedule_post'", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "deny",
      response: new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }),
        { status: 403 },
      ),
    });

    await POST(makeRequest(buildCsv()) as never);

    expect(mocks.requireCanDoForApi).toHaveBeenCalledWith(COMPANY_ID, "schedule_post");
  });

  it("does NOT call requireCanDoForApi with 'create_post'", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "deny",
      response: new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }),
        { status: 403 },
      ),
    });

    await POST(makeRequest(buildCsv()) as never);

    const calledActions = mocks.requireCanDoForApi.mock.calls.map(
      (c: unknown[]) => c[1],
    );
    expect(calledActions).not.toContain("create_post");
  });

  it("returns 202 when requireCanDoForApi allows schedule_post (approver-role user)", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "allow",
      userId: USER_ID,
    });

    const res = await POST(makeRequest(buildCsv()) as never);
    expect(res.status).toBe(202);
  });

  it("inserts drafted rows only when permitted (approver+)", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "allow",
      userId: USER_ID,
    });

    await POST(makeRequest(buildCsv()) as never);
    expect(mocks.insertDrafts).toHaveBeenCalledTimes(1);
  });

  it("does NOT insert any rows when permission is denied (editor)", async () => {
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "deny",
      response: new Response(
        JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }),
        { status: 403 },
      ),
    });

    await POST(makeRequest(buildCsv()) as never);
    expect(mocks.insertDrafts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G8: unresolvable channels guard
// ---------------------------------------------------------------------------

describe("G8 REGRESSION: bulk CSV rejects rows with no resolvable channels", () => {
  beforeEach(() => {
    // approver-role user for all G8 tests
    mocks.requireCanDoForApi.mockResolvedValue({
      kind: "allow",
      userId: USER_ID,
    });
  });

  it("returns 400 UNRESOLVABLE_CHANNELS when channel column does not match any connected platform", async () => {
    // The mock only has "linkedin" connected; "facebook" is not connected.
    const csv = buildCsv("facebook");
    const res = await POST(makeRequest(csv) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNRESOLVABLE_CHANNELS");
  });

  it("does NOT insert any rows when a channel is unresolvable", async () => {
    const csv = buildCsv("facebook");
    await POST(makeRequest(csv) as never);
    expect(mocks.insertDrafts).not.toHaveBeenCalled();
  });

  it("returns 202 when the channel resolves to a connected profile", async () => {
    const csv = buildCsv("linkedin");
    const res = await POST(makeRequest(csv) as never);
    expect(res.status).toBe(202);
  });

  it("error message identifies the offending row number", async () => {
    const csv = buildCsv("facebook");
    const res = await POST(makeRequest(csv) as never);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Row 1");
  });
});
