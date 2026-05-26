import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — G10: PATCH /api/platform/social/drafts/[id] with
// mode='schedule' or mode='post_now' and target_profile_ids=[] must return
// 422 MISSING_TARGET_PROFILES.
//
// A scheduled post with no target channels is permanently stuck — the publish
// cron job has nothing to dispatch to. This guard prevents the invalid state
// from being persisted in the first place.
//
// Bug: GitHub issue #1071.
// ---------------------------------------------------------------------------

const DRAFT_ID = "00000000-0000-4000-8000-000000000001";
const COMPANY_ID = "00000000-0000-4000-8000-000000000002";
const PROFILE_ID_1 = "00000000-0000-4000-8000-000000000003";

const updateMock = vi.fn();
const maybeSingleMock = vi.fn();
const platformCompaniesMock = vi.fn();

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: maybeSingleMock,
              }),
            }),
          }),
          update: (vals: unknown) => ({
            eq: (_c1: string, _v1: string) => ({
              eq: (_c2: string, _v2: string) => ({
                eq: (_c3: string, _v3: string) => ({
                  is: () => ({
                    select: () => ({
                      maybeSingle: () => updateMock(vals),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "platform_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: platformCompaniesMock,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

// date-fns-tz is used for timezone conversion; mock it minimally.
vi.mock("date-fns-tz", () => ({
  toZonedTime: (date: Date) => date,
}));

import { PATCH } from "@/app/api/platform/social/drafts/[id]/route";

const BASE_BODY = {
  draft_version: 1,
  content: "Hello world",
  media_urls: [],
  platform_variants: {},
  scheduled_at: "2026-06-01T10:00:00.000Z",
  planned_for_at: null,
  approval_required: false,
  approver_user_id: null,
};

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(
    `http://localhost/api/platform/social/drafts/${DRAFT_ID}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: draft exists in state='draft'.
  maybeSingleMock.mockResolvedValue({
    data: {
      company_id: COMPANY_ID,
      draft_data: {
        master_text: "",
        media_refs: [],
        target_connection_ids: [],
        approval_required: false,
        schedule: null,
        link_url: null,
        ai_metadata: null,
      },
      draft_version: 1,
    },
    error: null,
  });

  // Default: company timezone query.
  platformCompaniesMock.mockResolvedValue({
    data: { timezone: "UTC" },
    error: null,
  });

  // Default: update succeeds.
  updateMock.mockResolvedValue({
    data: { id: DRAFT_ID, draft_version: 2, state: "scheduled" },
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("R-G10: schedule with no target channels → 422 MISSING_TARGET_PROFILES", () => {
  it("mode='schedule' + empty target_profile_ids → 422", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "schedule", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(422);
  });

  it("mode='schedule' + empty target_profile_ids → body.error.code is MISSING_TARGET_PROFILES", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "schedule", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
  });

  it("mode='schedule' + empty target_profile_ids → body.error.retryable is false", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "schedule", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    const body = (await res.json()) as { error: { retryable: boolean } };
    expect(body.error.retryable).toBe(false);
  });

  it("mode='post_now' + empty target_profile_ids → 422", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "post_now", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(422);
  });

  it("mode='post_now' + empty target_profile_ids → body.error.code is MISSING_TARGET_PROFILES", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "post_now", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
  });

  it("mode='schedule' + empty target_profile_ids → DB update NOT called", async () => {
    await PATCH(
      makeRequest({ ...BASE_BODY, mode: "schedule", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("R-G10: schedule WITH targets → proceeds normally (not 422)", () => {
  it("mode='schedule' + one target → calls DB update (200 path)", async () => {
    const res = await PATCH(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [PROFILE_ID_1],
      }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    // update mock returns valid data → 200
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("mode='draft' + empty target_profile_ids → allowed (draft does not require targets)", async () => {
    const res = await PATCH(
      makeRequest({ ...BASE_BODY, mode: "draft", target_profile_ids: [] }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    // Guard does not fire for mode='draft'; DB update proceeds.
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("mode='recurring' + empty target_profile_ids → allowed (guard only blocks schedule/post_now)", async () => {
    const res = await PATCH(
      makeRequest({
        ...BASE_BODY,
        mode: "recurring",
        target_profile_ids: [],
        scheduled_at: null,
      }) as never,
      { params: Promise.resolve({ id: DRAFT_ID }) },
    );
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
