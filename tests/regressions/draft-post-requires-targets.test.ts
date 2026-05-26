import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — G10 (POST): POST /api/platform/social/drafts with
// mode='schedule' or mode='post_now' and target_profile_ids=[] must return
// 422 MISSING_TARGET_PROFILES.
//
// Same shape as the PATCH guard in draft-schedule-requires-targets.test.ts.
// Without this, a new draft can be created directly in state='scheduled'
// with no target channels — the publish cron has nothing to dispatch to and
// the row accumulates silently.
//
// Bug: GitHub issue #1071.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00000000-0000-4000-8000-000000000010";
const PROFILE_ID_1 = "00000000-0000-4000-8000-000000000011";

const insertMock = vi.fn();

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/platform/rate-limit", () => ({
  checkPlatformRateLimit: async () => ({ ok: true }),
  platformRateLimitExceeded: () => new Response(null, { status: 429 }),
  platformRateLimitUnavailable: () => new Response(null, { status: 503 }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          insert: (rows: unknown) => ({
            select: () => insertMock(rows),
          }),
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/platform/social/drafts/route";

const BASE_BODY = {
  company_id: COMPANY_ID,
  content: "Hello world",
  media_urls: [],
  platform_variants: {},
  approval_required: false,
};

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/platform/social/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertMock.mockResolvedValue({
    data: [{ id: "row-1", state: "scheduled", scheduled_at: null, parent_draft_id: null }],
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("R-G10-POST: schedule with no target channels → 422 MISSING_TARGET_PROFILES", () => {
  it("mode='schedule' + empty target_profile_ids → 422", async () => {
    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [],
        scheduled_at_list: ["2026-06-01T10:00:00.000Z"],
      }),
    );
    expect(res.status).toBe(422);
  });

  it("mode='schedule' + empty target_profile_ids → body.error.code is MISSING_TARGET_PROFILES", async () => {
    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [],
        scheduled_at_list: ["2026-06-01T10:00:00.000Z"],
      }),
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
  });

  it("mode='schedule' + empty target_profile_ids → body.error.retryable is false", async () => {
    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [],
        scheduled_at_list: ["2026-06-01T10:00:00.000Z"],
      }),
    );
    const body = (await res.json()) as { error: { retryable: boolean } };
    expect(body.error.retryable).toBe(false);
  });

  it("mode='post_now' + empty target_profile_ids → 422", async () => {
    const res = await POST(
      makeRequest({ ...BASE_BODY, mode: "post_now", target_profile_ids: [] }),
    );
    expect(res.status).toBe(422);
  });

  it("mode='post_now' + empty target_profile_ids → body.error.code is MISSING_TARGET_PROFILES", async () => {
    const res = await POST(
      makeRequest({ ...BASE_BODY, mode: "post_now", target_profile_ids: [] }),
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("MISSING_TARGET_PROFILES");
  });

  it("mode='schedule' + empty target_profile_ids → DB insert NOT called", async () => {
    await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [],
        scheduled_at_list: ["2026-06-01T10:00:00.000Z"],
      }),
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("R-G10-POST: schedule WITH targets → proceeds normally (not 422)", () => {
  it("mode='schedule' + one target → calls DB insert (201 path)", async () => {
    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "schedule",
        target_profile_ids: [PROFILE_ID_1],
        scheduled_at_list: ["2026-06-01T10:00:00.000Z"],
      }),
    );
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("mode='draft' + empty target_profile_ids → allowed (draft does not require targets)", async () => {
    const res = await POST(
      makeRequest({ ...BASE_BODY, mode: "draft", target_profile_ids: [] }),
    );
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("mode='recurring' + empty target_profile_ids → allowed (guard only blocks schedule/post_now)", async () => {
    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        mode: "recurring",
        target_profile_ids: [],
        recurrence: {
          rule: "FREQ=DAILY",
          starting_at: "2026-06-01T10:00:00.000Z",
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
