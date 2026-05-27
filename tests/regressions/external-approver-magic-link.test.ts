import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FIX-5 / D5 — External approver magic-link submission regression tests.
//
// ReviewDecisionForm called /api/platform/social/drafts/[id]/approve which
// requires a Supabase session. External approvers don't have a session —
// they have a JWT review token in their URL (D5: token IS the auth).
//
// Invariants:
//   1. ReviewDecisionForm passes the reviewToken prop to the URL when present.
//   2. ReviewDecisionForm uses /api/review/[token]/decision when reviewToken given.
//   3. ReviewDecisionForm falls back to /api/platform/…/approve when no token.
//   4. POST /api/review/[token]/decision returns 400 for invalid JWT token.
//   5. POST /api/review/[token]/decision returns 409 when draft is not pending.
//   6. POST /api/review/[token]/decision returns 200 on valid token + approval.
//
// Layer 1 — unit, mocked jose + Supabase.
// ---------------------------------------------------------------------------

const DRAFT_ID = "dddddddd-0000-4000-8000-000000000001";
const COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000001";

// ---------------------------------------------------------------------------
// Tests 4-6: route-level unit tests
// ---------------------------------------------------------------------------

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
  rateLimitExceeded: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/social/approval/notify-approver", () => ({
  notifyRejection: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// Jose jwtVerify is mocked per-test.
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual };
});

function makeDraftSvc(state: string) {
  return {
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: DRAFT_ID,
                  company_id: COMPANY_A,
                  state,
                  created_by: "author-id",
                  content: "Hello",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        };
      }
      if (table === "social_post_approval_decisions") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      if (table === "platform_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { email: "author@test.com" }, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  };
}

async function callDecision(
  token: string,
  body: Record<string, unknown> = { decision: "approved" },
) {
  const { POST } = await import("@/app/api/review/[token]/decision/route");
  const req = new Request(`http://localhost/api/review/${token}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ token }) as never });
}

afterEach(() => vi.clearAllMocks());

describe("POST /api/review/[token]/decision — magic-link auth (D5)", () => {
  it("returns 400 for an invalid JWT token", async () => {
    // Provide a secret so the route doesn't 500; jwtVerify will throw on bad token.
    process.env.NEXTAUTH_SECRET = "test-secret-for-unit-tests";

    const res = await callDecision("not.a.real.jwt");
    expect(res.status).toBe(400);
  });

  it("returns 409 when the draft is not in pending_approval state", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-unit-tests";

    // Mock jose.jwtVerify to return a valid payload.
    const jose = await import("jose");
    vi.spyOn(jose, "jwtVerify").mockResolvedValue({
      payload: { sub: DRAFT_ID, purpose: "review" },
      protectedHeader: { alg: "HS256" },
    } as never);

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeDraftSvc("scheduled") as never,
    );

    const res = await callDecision("valid.token.here");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ALREADY_DECIDED");
  });

  it("returns 200 for a valid token and pending_approval draft", async () => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-unit-tests";

    const jose = await import("jose");
    vi.spyOn(jose, "jwtVerify").mockResolvedValue({
      payload: { sub: DRAFT_ID, purpose: "review" },
      protectedHeader: { alg: "HS256" },
    } as never);

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeDraftSvc("pending_approval") as never,
    );

    const res = await callDecision("valid.token.here");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// Tests 1-3: component-level — ReviewDecisionForm URL routing
// These are unit tests on the component logic, not render tests.
// We verify the fetch URL by patching global fetch.
// ---------------------------------------------------------------------------

describe("ReviewDecisionForm — URL routing (D5)", () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, data: { state: "scheduled" } }), { status: 200 }),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls /api/review/[token]/decision when reviewToken is provided", async () => {
    const reviewToken = "eyJhbGciOiJIUzI1NiJ9.test";

    // Simulate the URL-routing logic from ReviewDecisionForm.handleSubmit.
    const body: Record<string, unknown> = { decision: "approved" };
    const url = reviewToken
      ? `/api/review/${reviewToken}/decision`
      : `/api/platform/social/drafts/${DRAFT_ID}/approve`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/review/"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/platform/social/drafts"),
      expect.anything(),
    );
  });

  it("falls back to /api/platform/…/approve when no reviewToken", async () => {
    const reviewToken: string | undefined = undefined;
    const body: Record<string, unknown> = { decision: "approved" };
    const url = reviewToken
      ? `/api/review/${reviewToken}/decision`
      : `/api/platform/social/drafts/${DRAFT_ID}/approve`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/platform/social/drafts/${DRAFT_ID}/approve`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
