import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// PR-13 — unit tests for retired V1 enqueueScheduledPublish.
//
// After pr-13, enqueueScheduledPublish is a logged no-op. All new posts
// use the V2 publish-due cron. These tests verify the retirement behaviour:
// valid inputs return { ok: true, data: { messageId: null } } without
// calling QStash, and invalid inputs still return validation errors.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockPublishJSON = vi.fn();
vi.mock("@/lib/qstash", () => ({
  getQstashClient: () => ({ publishJSON: mockPublishJSON }),
}));

const { enqueueScheduledPublish } = await import("@/lib/platform/social/publishing/enqueue");
const { logger } = await import("@/lib/logger");

const ENTRY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const FUTURE_ISO = new Date(Date.now() + 86400000).toISOString();

describe("enqueueScheduledPublish — V1 retired noop", () => {
  it("returns messageId: null without calling QStash", async () => {
    const result = await enqueueScheduledPublish({
      scheduleEntryId: ENTRY_ID,
      scheduledAt: FUTURE_ISO,
      origin: "https://app.opollo.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.messageId).toBeNull();
    }
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("logs a warning on every call", async () => {
    await enqueueScheduledPublish({
      scheduleEntryId: ENTRY_ID,
      scheduledAt: FUTURE_ISO,
      origin: "https://app.opollo.com",
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      "social.publish.enqueue.v1_retired",
      expect.objectContaining({ schedule_entry_id: ENTRY_ID }),
    );
  });

  it("returns VALIDATION_FAILED for missing scheduleEntryId", async () => {
    const result = await enqueueScheduledPublish({
      scheduleEntryId: "",
      scheduledAt: FUTURE_ISO,
      origin: "https://app.opollo.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("returns VALIDATION_FAILED for invalid scheduledAt", async () => {
    const result = await enqueueScheduledPublish({
      scheduleEntryId: ENTRY_ID,
      scheduledAt: "not-a-date",
      origin: "https://app.opollo.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });
});
