import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DI-004 — Internal draft approve endpoint missing optimistic concurrency guard.
//
// The UPDATE at /api/platform/social/drafts/[id]/approve had no
// .eq("state", "pending_approval") filter. Two concurrent approvers could
// both read pending_approval, both pass the state check, and both UPDATE
// would succeed — the last write wins, potentially overwriting approval with
// rejection. The external review route had the guard; the internal route
// didn't.
//
// Invariants:
//   1. Approve returns 200 when state filter matches (UPDATE returns rows).
//   2. Approve returns 409 ALREADY_DECIDED when UPDATE returns 0 rows
//      (concurrency collision detected).
//   3. The UPDATE call includes .eq("state", "pending_approval").
// ---------------------------------------------------------------------------

const DRAFT_ID = "dddddddd-0000-4000-8000-000000000010";
const COMPANY_ID = "cccccccc-0000-4000-8000-000000000001";
const APPROVER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

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

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn(async () => ({ kind: "allow", userId: APPROVER_ID })),
}));

let capturedUpdateFilter: { state?: string } = {};

const DRAFT_DATA = {
  id: DRAFT_ID,
  company_id: COMPANY_ID,
  state: "pending_approval",
  approver_user_id: APPROVER_ID,
  created_by: "author-id",
  content: "test",
};

function makeApproverDb(updateReturnsRows: boolean) {
  return {
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: DRAFT_DATA, error: null }),
              single: async () => ({ data: DRAFT_DATA, error: null }),
            }),
          }),
          update: () => ({
            eq: (_col: string, _val: string) => ({
              eq: (col: string, val: string) => {
                if (col === "state") capturedUpdateFilter.state = val;
                return {
                  select: () =>
                    Promise.resolve({
                      data: updateReturnsRows ? [{ id: DRAFT_ID }] : [],
                      error: null,
                    }),
                };
              },
            }),
          }),
        };
      }
      if (table === "social_post_approval_decisions") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "dec-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "platform_company_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { role: "admin" }, error: null }),
              }),
            }),
          }),
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
  capturedUpdateFilter = {};
});

async function callApprove(body = { decision: "approved" }, mockDb = makeApproverDb(true)) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  vi.mocked(getServiceRoleClient).mockReturnValue(mockDb as never);

  const { POST } = await import("@/app/api/platform/social/drafts/[id]/approve/route");
  const req = new Request(`http://localhost/api/platform/social/drafts/${DRAFT_ID}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: DRAFT_ID }) as never });
}

describe("POST /api/platform/social/drafts/[id]/approve — concurrency guard (DI-004)", () => {
  it("returns 200 when UPDATE matches a pending_approval row", async () => {
    const res = await callApprove();
    expect(res.status).toBe(200);
  });

  it("returns 409 ALREADY_DECIDED when UPDATE returns 0 rows (race detected)", async () => {
    const res = await callApprove({ decision: "approved" }, makeApproverDb(false));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ALREADY_DECIDED");
  });

  it("passes state='pending_approval' to the UPDATE filter", async () => {
    await callApprove();
    expect(capturedUpdateFilter.state).toBe("pending_approval");
  });
});
