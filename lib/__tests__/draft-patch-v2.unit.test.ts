import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

// ---------------------------------------------------------------------------
// Auth gate mock
// ---------------------------------------------------------------------------

const { mockRequireCanDo } = vi.hoisted(() => ({ mockRequireCanDo: vi.fn() }));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockRequireCanDo,
}));

import { PATCH } from "@/app/api/platform/social/drafts/[id]/route";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DRAFT_ID = "dddddddd-0000-0000-0000-000000000001";
const COMPANY_ID = "eeeeeeee-0000-0000-0000-000000000002";
const CONN_ID   = "ffffffff-0000-0000-0000-000000000003";

const BASE_ROW = {
  company_id: COMPANY_ID,
  draft_version: 3,
  state: "draft",
  draft_data: {
    master_text: "old content",
    media_refs: [],
    target_connection_ids: [],
    approval_required: false,
  },
};

const UPDATED_ROW = {
  id: DRAFT_ID,
  company_id: COMPANY_ID,
  draft_version: 4,
  content: "new content",
  scheduled_at: "2026-05-23T23:00:00.000Z",
  state: "scheduled",
  draft_data: {
    master_text: "new content",
    media_refs: [],
    target_connection_ids: [CONN_ID],
    approval_required: false,
    schedule: { date: "2026-05-24", times: ["09:00"] },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Universal chainable mock. All methods return `this`; `.update()` sets
// a flag so `.maybeSingle()` can return the correct result for that call.
function makeQueryChain(selectResult: unknown, updateResult?: unknown) {
  let usedUpdate = false;
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "update", "insert", "eq", "is", "not", "order", "limit"]) {
    chain[m] = vi.fn().mockImplementation(() => {
      if (m === "update") usedUpdate = true;
      return chain;
    });
  }
  chain["maybeSingle"] = vi.fn().mockImplementation(() => {
    const val = usedUpdate && updateResult !== undefined ? updateResult : selectResult;
    return Promise.resolve({ data: val, error: null });
  });
  return chain;
}

function makeRequest(body: unknown): Request {
  return new Request(`https://example.com/api/platform/social/drafts/${DRAFT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id = DRAFT_ID) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // resetAllMocks clears both call counts AND mockReturnValueOnce queues.
  // Without this, leftover queued values from early-returning tests leak.
  vi.resetAllMocks();
  // Re-apply implementations cleared by resetAllMocks.
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof getServiceRoleClient>);
  mockRequireCanDo.mockResolvedValue({ kind: "allow", userId: "user-1" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /api/platform/social/drafts/[id] — V2 body", () => {
  it("accepts V2 body (discriminated by content field) and returns 200", async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))             // draft row lookup
      .mockReturnValueOnce(makeQueryChain({ timezone: "Australia/Melbourne" })) // company tz
      .mockReturnValueOnce(makeQueryChain(null, UPDATED_ROW));   // CAS update

    const req = makeRequest({
      draft_version: 3,
      content: "new content",
      media_urls: [],
      target_profile_ids: [],  // empty is valid per schema; UUID format varies by Zod version
      platform_variants: {},
      mode: "schedule",
      scheduled_at: "2026-05-23T23:00:00.000Z",
      approval_required: false,
    });

    const res = await PATCH(req, makeParams());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("writes state=scheduled for mode=schedule", async () => {
    const updateChain = makeQueryChain(null, UPDATED_ROW);
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))
      .mockReturnValueOnce(makeQueryChain({ timezone: "UTC" }))
      .mockReturnValueOnce(updateChain);

    await PATCH(
      makeRequest({
        draft_version: 3,
        content: "scheduled post",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "schedule",
        scheduled_at: "2026-06-01T23:00:00.000Z",
        approval_required: false,
      }),
      makeParams(),
    );

    const updateFn = updateChain["update"] as ReturnType<typeof vi.fn>;
    expect(updateFn).toHaveBeenCalledOnce();
    const updateArg = updateFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg.state).toBe("scheduled");
  });

  it("writes state=draft and scheduled_at=null for mode=draft", async () => {
    const updateChain = makeQueryChain(null, { ...UPDATED_ROW, state: "draft", scheduled_at: null });
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))
      .mockReturnValueOnce(makeQueryChain({ timezone: "UTC" }))
      .mockReturnValueOnce(updateChain);

    await PATCH(
      makeRequest({
        draft_version: 3,
        content: "save as draft",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "draft",
        approval_required: false,
      }),
      makeParams(),
    );

    const updateFn = updateChain["update"] as ReturnType<typeof vi.fn>;
    const updateArg = updateFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg.state).toBe("draft");
    expect(updateArg.scheduled_at).toBeNull();
  });

  it("returns 409 VERSION_CONFLICT when CAS row is not found (stale version)", async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))
      .mockReturnValueOnce(makeQueryChain({ timezone: "UTC" }))
      .mockReturnValueOnce(makeQueryChain(null, null))            // CAS miss — update returns null
      .mockReturnValueOnce(makeQueryChain({ ...BASE_ROW, draft_version: 4 })); // getDraft fallback

    const res = await PATCH(
      makeRequest({
        draft_version: 3,
        content: "conflicting edit",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "draft",
        approval_required: false,
      }),
      makeParams(),
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VERSION_CONFLICT");
  });

  it("routes to V1 legacy path when body has draft_data but no content field", async () => {
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))
      .mockReturnValueOnce(makeQueryChain(null, { ...BASE_ROW, draft_version: 4 })); // saveDraft update

    const res = await PATCH(
      makeRequest({
        draft_version: 3,
        draft_data: {
          master_text: "v1 text",
          media_refs: [],
          target_connection_ids: [],
          approval_required: false,
        },
      }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    // V1 path should NOT call company timezone lookup (only 2 from() calls, not 3).
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("returns 404 when draft does not exist", async () => {
    mockFrom.mockReturnValueOnce(makeQueryChain(null)); // row lookup → null

    const res = await PATCH(
      makeRequest({
        draft_version: 1,
        content: "something",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "draft",
        approval_required: false,
      }),
      makeParams(),
    );

    expect(res.status).toBe(404);
  });

  it("returns 422 INVALID_STATE when the draft is already published (state guard)", async () => {
    // The composer must never silently flip a published post back to
    // scheduled / draft. See lib/social/post-state-actions.ts.
    mockFrom.mockReturnValueOnce(
      makeQueryChain({ ...BASE_ROW, state: "published" }),
    );

    const res = await PATCH(
      makeRequest({
        draft_version: 3,
        content: "trying to edit a live post",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "schedule",
        scheduled_at: "2026-06-01T23:00:00.000Z",
        approval_required: false,
      }),
      makeParams(),
    );

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("INVALID_STATE");
    expect(json.error.message).toContain("published");
  });

  it("returns 422 INVALID_STATE when the draft is currently publishing", async () => {
    mockFrom.mockReturnValueOnce(
      makeQueryChain({ ...BASE_ROW, state: "publishing" }),
    );

    const res = await PATCH(
      makeRequest({
        draft_version: 3,
        content: "trying to edit during publish",
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        mode: "draft",
        approval_required: false,
      }),
      makeParams(),
    );

    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_STATE");
  });

  it("returns 400 (VALIDATION_FAILED) on invalid V2 body (mode field missing)", async () => {
    // Body has 'content' → routes to V2 path after row lookup + auth gate.
    // Schema validation fails on missing 'mode' → validationError returns 400.
    mockFrom
      .mockReturnValueOnce(makeQueryChain(BASE_ROW))
      .mockReturnValueOnce(makeQueryChain({ timezone: "UTC" }));

    const res = await PATCH(
      makeRequest({
        content: "text without mode",
        draft_version: 3,
        media_urls: [],
        target_profile_ids: [],
        platform_variants: {},
        approval_required: false,
        // mode: intentionally absent
      }),
      makeParams(),
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });
});
