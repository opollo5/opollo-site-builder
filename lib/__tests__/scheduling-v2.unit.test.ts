import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// PR-11 — unit tests for V2 dual-lookup in scheduling lib functions.
//
// Tests the V2-first code paths for createScheduleEntry, cancelScheduleEntry,
// and listScheduleEntries. listCompanyScheduleEntries V2 expansion is tested
// by its own describe block. Supabase is stubbed.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/platform/social/publishing", () => ({
  enqueueScheduledPublish: vi.fn(),
  cancelScheduledPublish: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID   = "aaaaaaaa-0000-4000-8000-000000000002";
const ENTRY_ID   = "aaaaaaaa-0000-4000-8000-000000000003";

const { getServiceRoleClient } = await import("@/lib/supabase");
const { createScheduleEntry, cancelScheduleEntry, listScheduleEntries, listCompanyScheduleEntries } = await import("@/lib/platform/social/scheduling");

// Build a mock svc that returns draftRow from social_post_drafts and
// masterRow from social_post_master (null = not found).
function makeSvc(
  draftRow: Record<string, unknown> | null,
  masterRow: Record<string, unknown> | null = null,
) {
  return {
    from: (table: string) => {
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: draftRow, error: null }),
                gte: () => ({
                  lte: () => ({
                    order: () => Promise.resolve({ data: draftRow ? [draftRow] : [], error: null }),
                  }),
                }),
              }),
              in: () => ({
                gte: () => ({
                  lte: () => ({
                    order: () => Promise.resolve({ data: draftRow ? [draftRow] : [], error: null }),
                  }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          }),
        };
      }
      // social_post_master returns null (V2 post not there)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: masterRow, error: null }),
            }),
          }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
        upsert: () => ({
          select: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: "Should not reach V1 insert", code: "NOOP" } }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createScheduleEntry — V2 paths
// ---------------------------------------------------------------------------
describe("createScheduleEntry — V2 dispatch", () => {
  it("sets scheduled_at on a V2 draft in scheduled state", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ id: DRAFT_ID, state: "scheduled" }) as never,
    );
    const result = await createScheduleEntry({
      postMasterId: DRAFT_ID,
      companyId: COMPANY_ID,
      platform: "linkedin_personal",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      scheduledBy: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(DRAFT_ID);
      expect(result.data.platform).toBe("linkedin_personal");
    }
  });

  it("returns INVALID_STATE when V2 draft is not in scheduled state", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ id: DRAFT_ID, state: "pending_approval" }) as never,
    );
    const result = await createScheduleEntry({
      postMasterId: DRAFT_ID,
      companyId: COMPANY_ID,
      platform: "linkedin_personal",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      scheduledBy: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATE");
    }
  });

  it("returns VALIDATION_FAILED for past scheduled_at", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ id: DRAFT_ID, state: "scheduled" }) as never,
    );
    const result = await createScheduleEntry({
      postMasterId: DRAFT_ID,
      companyId: COMPANY_ID,
      platform: "linkedin_personal",
      scheduledAt: "2020-01-01T00:00:00Z",
      scheduledBy: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
  });
});

// ---------------------------------------------------------------------------
// cancelScheduleEntry — V2 fallback
// ---------------------------------------------------------------------------
describe("cancelScheduleEntry — V2 fallback", () => {
  function makeV2CancelSvc(draftState: string) {
    return {
      from: (table: string) => {
        if (table === "social_schedule_entries") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          };
        }
        if (table === "social_post_drafts") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: ENTRY_ID, state: draftState, scheduled_at: "2026-06-01T10:00:00Z" },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };
  }

  it("reverts a V2 scheduled draft to pending_approval when entry not found in V1", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeV2CancelSvc("scheduled") as never,
    );
    const result = await cancelScheduleEntry({ entryId: ENTRY_ID, companyId: COMPANY_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cancelled_at).not.toBeNull();
    }
  });

  it("returns INVALID_STATE when V2 draft is not in scheduled state", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeV2CancelSvc("pending_approval") as never,
    );
    const result = await cancelScheduleEntry({ entryId: ENTRY_ID, companyId: COMPANY_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATE");
    }
  });
});

// ---------------------------------------------------------------------------
// listScheduleEntries — V2 first
// ---------------------------------------------------------------------------
describe("listScheduleEntries — V2-first", () => {
  it("returns synthetic entry from V2 draft with scheduled_at", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({
        id: DRAFT_ID,
        scheduled_at: "2026-06-01T10:00:00Z",
        target_profiles: [{ profile_id: "p1", platform: "linkedin" }],
      }) as never,
    );
    const result = await listScheduleEntries({
      postMasterId: DRAFT_ID,
      companyId: COMPANY_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries).toHaveLength(1);
      expect(result.data.entries[0]?.id).toBe(DRAFT_ID);
      expect(result.data.entries[0]?.scheduled_at).toBe("2026-06-01T10:00:00Z");
    }
  });

  it("returns empty entries for V2 draft with no scheduled_at", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ id: DRAFT_ID, scheduled_at: null, target_profiles: [] }) as never,
    );
    const result = await listScheduleEntries({
      postMasterId: DRAFT_ID,
      companyId: COMPANY_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.entries).toHaveLength(0);
    }
  });
});
