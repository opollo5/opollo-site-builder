import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// PR-08 — unit tests for V2 dual-lookup approval routes.
//
// Covers: submit, approve, reject, cancel-approval, request-changes.
// All five routes share the same pattern: V2-first lookup in social_post_drafts,
// V1 fallback. Supabase and downstream libs are stubbed.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

// ---- Supabase stub ----
const mockUpdate = vi.fn();
const mockEqChain = {
  eq: vi.fn().mockReturnThis(),
};
const mockUpdateEqChain = { ...mockEqChain };
mockUpdate.mockReturnValue(mockUpdateEqChain);

const mockMaybeSingle = vi.fn();
const mockSelectFromSingle = {
  eq: vi.fn().mockReturnThis(),
  maybeSingle: mockMaybeSingle,
};
const mockFrom = vi.fn(() => ({
  select: vi.fn(() => mockSelectFromSingle),
  update: mockUpdate,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({ from: mockFrom }),
}));

// ---- Auth stub ----
const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID    = "aaaaaaaa-0000-4000-8000-000000000002";
const POST_ID    = "aaaaaaaa-0000-4000-8000-000000000003";

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn().mockResolvedValue({ kind: "allow", userId: USER_ID, response: null }),
}));

// ---- Notification stub ----
vi.mock("@/lib/platform/notifications", () => ({
  dispatch: vi.fn().mockResolvedValue(undefined),
}));

// ---- V1 lib stubs ----
vi.mock("@/lib/platform/social/posts", () => ({
  submitForApproval:       vi.fn().mockResolvedValue({ ok: true, data: { id: POST_ID, state: "pending_client_approval" } }),
  approvePost:             vi.fn().mockResolvedValue({ ok: true, data: { id: POST_ID, state: "approved", createdBy: USER_ID } }),
  rejectPost:              vi.fn().mockResolvedValue({ ok: true, data: { id: POST_ID, state: "rejected", createdBy: USER_ID, comment: null } }),
  cancelApprovalRequest:   vi.fn().mockResolvedValue({ ok: true, data: { id: POST_ID, state: "draft" } }),
  requestChanges:          vi.fn().mockResolvedValue({ ok: true, data: { id: POST_ID, state: "changes_requested", createdBy: USER_ID, comment: null } }),
}));

// ---- Next.js stubs ----
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

// ---- Dynamic imports after mocks ----
const { POST: submitPOST } = await import(
  "@/app/api/platform/social/posts/[id]/submit/route"
);
const { POST: approvePOST } = await import(
  "@/app/api/platform/social/posts/[id]/approve/route"
);
const { POST: rejectPOST } = await import(
  "@/app/api/platform/social/posts/[id]/reject/route"
);
const { POST: cancelPOST } = await import(
  "@/app/api/platform/social/posts/[id]/cancel-approval/route"
);
const { POST: requestChangesPOST } = await import(
  "@/app/api/platform/social/posts/[id]/request-changes/route"
);

// ---- Helpers ----
function makeReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockReturnValue({ ...mockUpdateEqChain, eq: vi.fn().mockReturnThis() });
  mockFrom.mockReturnValue({
    select: vi.fn(() => ({ ...mockSelectFromSingle, eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
    update: mockUpdate,
  });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// submit — draft → pending_approval
// ---------------------------------------------------------------------------
describe("submit/route — V2 dispatch", () => {
  it("transitions draft → pending_approval in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "draft" }, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: updateMock,
    });
    const res = await submitPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { body: { data: { state: string } } }).body.data.state).toBe("pending_approval");
  });

  it("returns 409 when V2 draft is not in draft state", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "pending_approval" }, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const res = await submitPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { status: number }).status).toBe(409);
  });

  it("falls through to V1 when post not in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const { submitForApproval } = await import("@/lib/platform/social/posts");
    const res = await submitPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect(submitForApproval).toHaveBeenCalled();
    expect((res as unknown as { body: { ok: boolean } }).body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// approve — pending_approval → scheduled (OD-1)
// ---------------------------------------------------------------------------
describe("approve/route — V2 dispatch", () => {
  it("transitions pending_approval → scheduled in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "pending_approval", created_by: USER_ID }, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: updateMock,
    });
    const res = await approvePOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { body: { data: { state: string } } }).body.data.state).toBe("scheduled");
  });

  it("returns 409 when V2 draft is not in pending_approval", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "draft", created_by: USER_ID }, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const res = await approvePOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { status: number }).status).toBe(409);
  });

  it("falls through to V1 approvePost when not in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const { approvePost } = await import("@/lib/platform/social/posts");
    await approvePOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect(approvePost).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reject — pending_approval → rejected
// ---------------------------------------------------------------------------
describe("reject/route — V2 dispatch", () => {
  it("transitions pending_approval → rejected in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "pending_approval", created_by: USER_ID }, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: updateMock,
    });
    const res = await rejectPOST(
      makeReq({ company_id: COMPANY_ID, comment: "Not ready" }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { body: { data: { state: string } } }).body.data.state).toBe("rejected");
  });

  it("falls through to V1 rejectPost when not in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const { rejectPost } = await import("@/lib/platform/social/posts");
    await rejectPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect(rejectPost).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancel-approval — pending_approval → draft
// ---------------------------------------------------------------------------
describe("cancel-approval/route — V2 dispatch", () => {
  it("transitions pending_approval → draft in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "pending_approval" }, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: updateMock,
    });
    const res = await cancelPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { body: { data: { state: string } } }).body.data.state).toBe("draft");
  });

  it("falls through to V1 cancelApprovalRequest when not in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const { cancelApprovalRequest } = await import("@/lib/platform/social/posts");
    await cancelPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect(cancelApprovalRequest).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// request-changes — no-op in V2 (stays pending_approval)
// ---------------------------------------------------------------------------
describe("request-changes/route — V2 dispatch", () => {
  it("returns pending_approval as no-op for V2 post", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: POST_ID, state: "pending_approval", created_by: USER_ID }, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const res = await requestChangesPOST(
      makeReq({ company_id: COMPANY_ID, comment: "Please fix X" }) as never,
      makeParams(POST_ID) as never,
    );
    expect((res as unknown as { body: { data: { state: string } } }).body.data.state).toBe("pending_approval");
  });

  it("falls through to V1 requestChanges when not in V2 table", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn().mockReturnThis(), maybeSingle: mockMaybeSingle })),
      update: vi.fn(),
    });
    const { requestChanges } = await import("@/lib/platform/social/posts");
    await requestChangesPOST(
      makeReq({ company_id: COMPANY_ID }) as never,
      makeParams(POST_ID) as never,
    );
    expect(requestChanges).toHaveBeenCalled();
  });
});
