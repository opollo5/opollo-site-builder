import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// LAYER 1 — Unit. Mocks Supabase + QStash + bundle.social SDK.
//
// Tests enqueuePostHistoryImport's dedup behaviour and the runner's
// status transitions. The active-dedup partial unique index in migration
// 0121 absorbs duplicate queues at the DB level — this test pins the
// application-side handling of the resulting 23505 conflict.

const insertMock = vi.fn();
const selectByDedupMock = vi.fn();
const updateMock = vi.fn();
const publishJsonMock = vi.fn();

vi.mock("@/lib/qstash", () => ({
  getQstashClient: () => ({
    publishJSON: publishJsonMock,
  }),
}));

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => null,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(_table: string) {
      return {
        insert(_row: unknown) {
          return {
            select() {
              return {
                maybeSingle() {
                  return insertMock();
                },
              };
            },
          };
        },
        select(_cols: string) {
          return {
            eq() {
              return {
                eq() {
                  return {
                    in() {
                      return {
                        maybeSingle() {
                          return selectByDedupMock();
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        update(_patch: unknown) {
          return {
            eq() {
              return updateMock();
            },
          };
        },
      };
    },
  }),
}));

// Sub-path import: barrel @/lib/platform/social/analytics-ingest also pulls
// in ./refresh + ./dashboard. This test only needs enqueuePostHistoryImport;
// importing the leaf file skips the other heavy sub-modules' transforms.
import { enqueuePostHistoryImport } from "@/lib/platform/social/analytics-ingest/post-history-import";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  insertMock.mockReset();
  selectByDedupMock.mockReset();
  updateMock.mockReset();
  publishJsonMock.mockReset();
  publishJsonMock.mockResolvedValue({ messageId: "msg-1" });
  updateMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BSP analytics — enqueuePostHistoryImport", () => {
  it("returns 'skipped' for platforms unsupported by bundle.social postImport (x)", async () => {
    const r = await enqueuePostHistoryImport({
      profileId: PROFILE_ID,
      bundleSocialAccountId: "acct-1",
      platform: "x",
      origin: "https://app.opollo.com",
    });
    expect(r.kind).toBe("skipped");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 'skipped' for gbp (post import unsupported)", async () => {
    const r = await enqueuePostHistoryImport({
      profileId: PROFILE_ID,
      bundleSocialAccountId: "acct-1",
      platform: "gbp",
      origin: "https://app.opollo.com",
    });
    expect(r.kind).toBe("skipped");
  });

  it("inserts a queued row and enqueues a QStash job on the happy path", async () => {
    insertMock.mockResolvedValue({
      data: { id: "import-row-1" },
      error: null,
    });

    const r = await enqueuePostHistoryImport({
      profileId: PROFILE_ID,
      bundleSocialAccountId: "acct-1",
      platform: "linkedin_company",
      origin: "https://app.opollo.com",
    });

    expect(r.kind).toBe("queued");
    if (r.kind !== "queued") throw new Error("kind narrowing");
    expect(r.importRowId).toBe("import-row-1");
    expect(r.reEnqueued).toBe(true);
    expect(publishJsonMock).toHaveBeenCalledTimes(1);
    const call = publishJsonMock.mock.calls[0][0] as {
      url: string;
      body: { importRowId: string };
      deduplicationId: string;
    };
    expect(call.url).toContain("/api/webhooks/qstash/social-post-history-import");
    expect(call.body.importRowId).toBe("import-row-1");
    expect(call.deduplicationId).toBe("social-post-history-import-import-row-1");
  });

  it("absorbs duplicate inserts (code 23505) and returns already_active with the existing row id", async () => {
    insertMock.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    selectByDedupMock.mockResolvedValue({
      data: { id: "existing-row", status: "running" },
      error: null,
    });

    const r = await enqueuePostHistoryImport({
      profileId: PROFILE_ID,
      bundleSocialAccountId: "acct-1",
      platform: "facebook_page",
      origin: "https://app.opollo.com",
    });

    expect(r.kind).toBe("already_active");
    if (r.kind !== "already_active") throw new Error("kind narrowing");
    expect(r.importRowId).toBe("existing-row");
    // Critical: no QStash enqueue when the dedup absorbs the insert.
    expect(publishJsonMock).not.toHaveBeenCalled();
  });

  it("throws on unexpected insert error codes (not 23505)", async () => {
    insertMock.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "table does not exist" },
    });

    await expect(
      enqueuePostHistoryImport({
        profileId: PROFILE_ID,
        bundleSocialAccountId: "acct-1",
        platform: "linkedin_personal",
        origin: "https://app.opollo.com",
      }),
    ).rejects.toThrow(/table does not exist/);
  });
});
