import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// PR-14 — unit tests for V2 dual-lookup in BSP webhook processBundlesocialWebhook.
//
// When a post.published / post.failed event arrives for a bundle_post_id
// that is NOT in social_publish_attempts (V1), we fall back to checking
// social_post_drafts.bundle_post_id (V2). If found, we dispatch the
// notification and return kind: "ok".
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockNotifyDispatch = vi.fn().mockResolvedValue({ inApp: 1, emails: 0, errors: [] });
vi.mock("@/lib/platform/notifications", () => ({
  dispatch: mockNotifyDispatch,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DRAFT_ID   = "aaaaaaaa-0000-4000-8000-000000000002";
const EVENT_ID   = "bsp_event_001";
const BUNDLE_POST_ID = "bsp_post_abc123";

const { getServiceRoleClient } = await import("@/lib/supabase");
const { processBundlesocialWebhook } = await import("@/lib/platform/social/webhooks/process");

// Build a mock svc where:
//   - social_webhook_events.insert → success
//   - social_publish_attempts lookup → returns null (V1 not found)
//   - social_post_drafts lookup → returns the provided draftRow or null
function makeSvc(draftRow: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === "social_webhook_events") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: "wh_row_01", processed_at: null },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => ({ error: null }),
          }),
        };
      }
      if (table === "social_publish_attempts") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "social_post_drafts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: draftRow, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processBundlesocialWebhook — V2 post.published", () => {
  it("dispatches post_published notification when V2 draft found by bundle_post_id", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({
        id: DRAFT_ID,
        company_id: COMPANY_ID,
        created_by: "user_001",
        target_profiles: [{ profile_id: "p1", platform: "linkedin" }],
        published_url: "https://linkedin.com/post/123",
      }) as never,
    );

    const result = await processBundlesocialWebhook({
      envelope: {
        id: EVENT_ID,
        type: "post.published",
        teamId: "team_01",
        data: { bundlePostId: BUNDLE_POST_ID, platformPostUrl: "https://linkedin.com/post/123" },
      },
      rawPayload: {},
      signatureValid: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.action).toContain("post_published");
    }
    expect(mockNotifyDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "post_published",
        companyId: COMPANY_ID,
        postMasterId: DRAFT_ID,
        platform: "linkedin",
      }),
    );
  });

  it("dispatches post_failed notification when V2 draft found", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({
        id: DRAFT_ID,
        company_id: COMPANY_ID,
        created_by: "user_001",
        target_profiles: [{ profile_id: "p1", platform: "instagram" }],
        published_url: null,
      }) as never,
    );

    const result = await processBundlesocialWebhook({
      envelope: {
        id: EVENT_ID,
        type: "post.failed",
        teamId: "team_01",
        data: {
          bundlePostId: BUNDLE_POST_ID,
          error: { class: "AUTH_ERROR", message: "Token expired" },
        },
      },
      rawPayload: {},
      signatureValid: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.action).toContain("post_failed");
    }
    expect(mockNotifyDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "post_failed",
        companyId: COMPANY_ID,
        postMasterId: DRAFT_ID,
        platform: "instagram",
        errorMessage: "Token expired",
      }),
    );
  });

  it("returns stored_no_action when neither V1 attempt nor V2 draft found", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(makeSvc(null) as never);

    const result = await processBundlesocialWebhook({
      envelope: {
        id: EVENT_ID,
        type: "post.published",
        teamId: "team_01",
        data: { bundlePostId: BUNDLE_POST_ID },
      },
      rawPayload: {},
      signatureValid: true,
    });

    expect(result.kind).toBe("stored_no_action");
    expect(mockNotifyDispatch).not.toHaveBeenCalled();
  });

  it("uses unknown platform when target_profiles is empty", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({
        id: DRAFT_ID,
        company_id: COMPANY_ID,
        created_by: "user_001",
        target_profiles: [],
        published_url: null,
      }) as never,
    );

    const result = await processBundlesocialWebhook({
      envelope: {
        id: EVENT_ID,
        type: "post.published",
        teamId: "team_01",
        data: { bundlePostId: BUNDLE_POST_ID },
      },
      rawPayload: {},
      signatureValid: true,
    });

    expect(result.kind).toBe("ok");
    expect(mockNotifyDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "unknown" }),
    );
  });
});
