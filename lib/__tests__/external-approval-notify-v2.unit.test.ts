import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// PR-09 — unit tests for V2-first notification lookup in
// POST /api/approve/[token]/decision.
//
// The route calls recordApprovalDecision (V1 token auth), then fires a
// notification by looking up the post's company_id + created_by.
// After backfill, the post lives in social_post_drafts (V2), not
// social_post_master (V1). The route now tries V2 first and falls back to V1.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ ok: true })),
  rateLimitExceeded: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const dispatchMock = vi.fn(async () => {});
vi.mock("@/lib/platform/notifications", () => ({
  dispatch: dispatchMock,
}));

const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const POST_ID    = "aaaaaaaa-0000-4000-8000-000000000003";
const CREATOR_ID = "aaaaaaaa-0000-4000-8000-000000000002";

const recordApprovalDecisionMock = vi.fn().mockResolvedValue({
  ok: true,
  data: { finalised: true, postId: POST_ID },
});
vi.mock("@/lib/platform/social/approvals", () => ({
  recordApprovalDecision: recordApprovalDecisionMock,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// Build a mock Supabase client where:
// - social_post_drafts returns draftRow (or null)
// - social_post_master returns masterRow (or null)
function makeFromMock(
  draftRow: Record<string, unknown> | null,
  masterRow: Record<string, unknown> | null,
) {
  return {
    from: (table: string) => {
      const row = table === "social_post_drafts" ? draftRow : masterRow;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      };
    },
  };
}

const TOKEN = "a".repeat(64); // 64 hex chars — passes TOKEN_RE

function makeReq(body: unknown = { decision: "approved" }) {
  return new Request(`http://localhost/api/approve/${TOKEN}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Dynamic imports AFTER mocks are registered
const { POST } = await import("@/app/api/approve/[token]/decision/route");
const { getServiceRoleClient } = await import("@/lib/supabase");

beforeEach(() => {
  vi.clearAllMocks();
  recordApprovalDecisionMock.mockResolvedValue({
    ok: true,
    data: { finalised: true, postId: POST_ID },
  });
});

describe("POST /api/approve/[token]/decision — V2-first notification lookup", () => {
  it("fires approval_decided from V2 data when post is in social_post_drafts", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeFromMock(
        { company_id: COMPANY_ID, created_by: CREATOR_ID },
        null,
      ) as never,
    );

    const res = await POST(
      makeReq() as never,
      { params: Promise.resolve({ token: TOKEN }) } as never,
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "approval_decided",
        companyId: COMPANY_ID,
        submitterUserId: CREATOR_ID,
        decision: "approved",
      }),
    );
  });

  it("fires approval_decided from V1 data when post is NOT in social_post_drafts", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeFromMock(
        null,
        { company_id: COMPANY_ID, created_by: CREATOR_ID },
      ) as never,
    );

    const res = await POST(
      makeReq() as never,
      { params: Promise.resolve({ token: TOKEN }) } as never,
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "approval_decided",
        companyId: COMPANY_ID,
        submitterUserId: CREATOR_ID,
        decision: "approved",
      }),
    );
  });

  it("fires changes_requested event for changes_requested decision (V2 path)", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeFromMock(
        { company_id: COMPANY_ID, created_by: CREATOR_ID },
        null,
      ) as never,
    );

    const res = await POST(
      makeReq({ decision: "changes_requested", comment: "Please revise" }) as never,
      { params: Promise.resolve({ token: TOKEN }) } as never,
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "changes_requested" }),
    );
  });

  it("skips notification silently when neither V2 nor V1 has the post", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeFromMock(null, null) as never,
    );

    const res = await POST(
      makeReq() as never,
      { params: Promise.resolve({ token: TOKEN }) } as never,
    );
    expect(res.status).toBe(200);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("does not fire notification when finalised=false", async () => {
    recordApprovalDecisionMock.mockResolvedValue({
      ok: true,
      data: { finalised: false, postId: POST_ID },
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeFromMock(
        { company_id: COMPANY_ID, created_by: CREATOR_ID },
        null,
      ) as never,
    );

    await POST(
      makeReq() as never,
      { params: Promise.resolve({ token: TOKEN }) } as never,
    );
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
