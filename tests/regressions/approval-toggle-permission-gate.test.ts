import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FIX-4 / DI-010 — ApprovalToggle permission gate regression tests.
//
// POST /api/platform/social/drafts/[id]/approve was gating on "edit_post"
// (editor+) instead of "approve_post" (approver/admin). This allowed editors
// to approve drafts even when named as approver_user_id, violating the role
// hierarchy (admin > approver > editor > viewer).
//
// Invariants:
//   1. The route uses "approve_post" as the permission gate action.
//   2. A deny from requireCanDoForApi propagates to a 4xx response.
//   3. A valid approver (allow gate) can approve a pending_approval draft.
//
// Layer 1 — unit, mocked api-gate + Supabase. No real DB needed.
// ---------------------------------------------------------------------------

const COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID = "dddddddd-0000-4000-8000-000000000001";
const APPROVER_ID = "cccccccc-0000-4000-8000-000000000001";

let capturedGateAction: string | null = null;

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
  requireCanDoForApi: vi.fn(async (_companyId: string, action: string) => {
    capturedGateAction = action;
    // Default: allow
    return {
      kind: "allow",
      userId: APPROVER_ID,
      supabase: {},
    };
  }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

function makeDraftMock(draftData: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: draftData, error: null }),
              single: async () => ({ data: draftData, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "platform_company_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { role: "approver" }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "social_post_approval_decisions") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "decision-id" }, error: null }),
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

beforeEach(() => {
  capturedGateAction = null;
});

afterEach(() => vi.clearAllMocks());

async function callApprove(draftId: string, body: Record<string, unknown> = { decision: "approved" }) {
  const { POST } = await import(
    "@/app/api/platform/social/drafts/[id]/approve/route"
  );
  const req = new Request(`http://localhost/api/platform/social/drafts/${draftId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: draftId }) as never });
}

describe("POST /api/platform/social/drafts/[id]/approve — permission gate (DI-010)", () => {
  it("gates on approve_post, not edit_post", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeDraftMock({
        id: DRAFT_ID,
        company_id: COMPANY_A,
        state: "pending_approval",
        approver_user_id: APPROVER_ID,
        created_by: "author-id",
        content: "Test post",
      }) as never,
    );

    await callApprove(DRAFT_ID);
    expect(capturedGateAction).toBe("approve_post");
    expect(capturedGateAction).not.toBe("edit_post");
  });

  it("returns 4xx when requireCanDoForApi denies", async () => {
    const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 401 }),
    } as never);

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeDraftMock({
        id: DRAFT_ID,
        company_id: COMPANY_A,
        state: "pending_approval",
        approver_user_id: "other-user",
        created_by: "author-id",
        content: "Test post",
      }) as never,
    );

    const res = await callApprove(DRAFT_ID);
    expect(res.status).toBe(401);
  });

  it("returns 200 when approver_user_id matches the gated userId", async () => {
    const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "allow",
      userId: APPROVER_ID,
      supabase: {},
    } as never);

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeDraftMock({
        id: DRAFT_ID,
        company_id: COMPANY_A,
        state: "pending_approval",
        approver_user_id: APPROVER_ID,
        created_by: "author-id",
        content: "Test post",
      }) as never,
    );

    const res = await callApprove(DRAFT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
