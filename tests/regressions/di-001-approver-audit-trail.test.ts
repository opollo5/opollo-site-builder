import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DI-001 — External approval decision inserts null into NOT NULL column.
//
// POST /api/review/[token]/decision inserts approver_user_id: null for
// external approvers (they have no platform user_id by design). The column
// was NOT NULL in migration 0134, causing a constraint violation that was
// silently swallowed — no audit row was ever written.
//
// Migration 0154 drops the NOT NULL constraint on approver_user_id and adds
// an approver_email TEXT column. After the migration, the null insert succeeds.
//
// Invariants (route behaviour after migration):
//   1. The decision insert is attempted with approver_user_id: null.
//   2. When the insert succeeds (column now nullable), the route returns 200.
//   3. When the insert fails for any other reason, the route still returns 200
//      (best-effort — state transition already committed).
// ---------------------------------------------------------------------------

const DRAFT_ID = "dddddddd-0000-4000-8000-000000000012";
const COMPANY_ID = "cccccccc-0000-4000-8000-000000000004";

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

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual };
});

let capturedDecisionRow: Record<string, unknown> | null = null;

function makeDb(insertSucceeds: boolean) {
  return {
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: DRAFT_ID,
                  company_id: COMPANY_ID,
                  state: "pending_approval",
                  created_by: "author-id",
                  content: "hello",
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: [{ id: DRAFT_ID }], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "social_post_approval_decisions") {
        return {
          insert: (row: Record<string, unknown>) => {
            capturedDecisionRow = row;
            if (!insertSucceeds) {
              return Promise.resolve({ error: { message: "not-null violation" } });
            }
            return Promise.resolve({ error: null });
          },
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

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  capturedDecisionRow = null;
});

async function callDecision(decision = "approved") {
  const jose = await import("jose");
  vi.spyOn(jose, "jwtVerify").mockResolvedValue({
    payload: { sub: DRAFT_ID, purpose: "review" },
    protectedHeader: { alg: "HS256" },
  } as never);
  process.env.NEXTAUTH_SECRET = "test-secret-for-unit-tests";

  const { getServiceRoleClient } = await import("@/lib/supabase");
  vi.mocked(getServiceRoleClient).mockReturnValue(makeDb(true) as never);

  const { POST } = await import("@/app/api/review/[token]/decision/route");
  const req = new Request("http://localhost/api/review/token/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return POST(req as never, { params: Promise.resolve({ token: "valid.token" }) as never });
}

describe("POST /api/review/[token]/decision — approver audit trail (DI-001)", () => {
  it("inserts approver_user_id: null (external approver path)", async () => {
    await callDecision();
    expect(capturedDecisionRow).toBeTruthy();
    expect((capturedDecisionRow as Record<string, unknown>)?.approver_user_id).toBeNull();
  });

  it("returns 200 even when approver_user_id is null (column now nullable)", async () => {
    const res = await callDecision();
    expect(res.status).toBe(200);
  });

  it("returns 200 even if the decision insert fails (best-effort behaviour)", async () => {
    const jose = await import("jose");
    vi.spyOn(jose, "jwtVerify").mockResolvedValue({
      payload: { sub: DRAFT_ID, purpose: "review" },
      protectedHeader: { alg: "HS256" },
    } as never);
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(makeDb(false) as never);

    const { POST } = await import("@/app/api/review/[token]/decision/route");
    const req = new Request("http://localhost/api/review/token/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    const res = await POST(req as never, { params: Promise.resolve({ token: "valid.token" }) as never });
    expect(res.status).toBe(200);
  });
});
