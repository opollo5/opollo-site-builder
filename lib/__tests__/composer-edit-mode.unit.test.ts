import { describe, it, expect } from "vitest";

// mapV1ToV2Draft is an internal implementation exported for testing.
// schedulingCardValueFromIso is exported from ComposerOverlay for testing.
//
// Both are pure functions — no server-only or DB deps, no mocks needed.

// ---------------------------------------------------------------------------
// mapV1ToV2Draft
// ---------------------------------------------------------------------------

// Import via the component's exported symbol.
import { mapV1ToV2Draft } from "@/components/composer/composer-mount-v2";

describe("mapV1ToV2Draft", () => {
  const base = {
    id: "abc-123",
    draft_version: 7,
    draft_data: {
      master_text: "v1 fallback text",
      media_refs: [{ url: "https://cdn.example.com/img.jpg" }],
      target_connection_ids: ["conn-1", "conn-2"],
      approval_required: true,
    },
  };

  it("uses top-level scheduled_at when present (V2 path)", () => {
    const d = { ...base, scheduled_at: "2026-05-23T23:00:00.000Z" };
    const result = mapV1ToV2Draft(d);
    expect(result.scheduled_at).toBe("2026-05-23T23:00:00.000Z");
  });

  it("falls back to draft_data.schedule when top-level scheduled_at is absent (V1 path)", () => {
    const d = {
      ...base,
      scheduled_at: null,
      draft_data: {
        ...base.draft_data,
        schedule: { date: "2026-05-24", times: ["09:00"] },
      },
    };
    const result = mapV1ToV2Draft(d);
    expect(result.scheduled_at).toBe("2026-05-24T09:00:00Z");
  });

  it("returns null scheduled_at when neither top-level nor draft_data.schedule is set", () => {
    const result = mapV1ToV2Draft(base);
    expect(result.scheduled_at).toBeNull();
  });

  it("prefers top-level scheduled_at over draft_data.schedule", () => {
    const d = {
      ...base,
      scheduled_at: "2026-05-23T23:00:00.000Z",
      draft_data: {
        ...base.draft_data,
        schedule: { date: "2026-05-24", times: ["09:00"] },
      },
    };
    const result = mapV1ToV2Draft(d);
    expect(result.scheduled_at).toBe("2026-05-23T23:00:00.000Z");
  });

  it("maps content, media_urls, target_profile_ids, approval_required, draft_version", () => {
    const d = { ...base, content: "top-level content" };
    const result = mapV1ToV2Draft(d);
    expect(result.id).toBe("abc-123");
    expect(result.draft_version).toBe(7);
    expect(result.content).toBe("top-level content");
    expect(result.media_urls).toEqual(["https://cdn.example.com/img.jpg"]);
    expect(result.target_profile_ids).toEqual(["conn-1", "conn-2"]);
    expect(result.approval_required).toBe(true);
  });

  it("falls back to draft_data.master_text when top-level content is absent", () => {
    const result = mapV1ToV2Draft(base);
    expect(result.content).toBe("v1 fallback text");
  });

  it("uses first time entry when draft_data.schedule has multiple times", () => {
    const d = {
      ...base,
      scheduled_at: null,
      draft_data: {
        ...base.draft_data,
        schedule: { date: "2026-06-01", times: ["10:00", "14:00"] },
      },
    };
    const result = mapV1ToV2Draft(d);
    expect(result.scheduled_at).toBe("2026-06-01T10:00:00Z");
  });
});

// ---------------------------------------------------------------------------
// schedulingCardValueFromIso
// ---------------------------------------------------------------------------

// date-fns-tz must be resolvable — it is in package.json.
import { schedulingCardValueFromIso } from "@/components/social/composer/ComposerOverlay";

describe("schedulingCardValueFromIso", () => {
  const MEL = "Australia/Melbourne";

  it("returns default (post_now mode) when iso is null", () => {
    const val = schedulingCardValueFromIso(null, MEL);
    expect(val.mode).toBe("post_now");
  });

  it("returns default when iso is undefined", () => {
    const val = schedulingCardValueFromIso(undefined, MEL);
    expect(val.mode).toBe("post_now");
  });

  it("returns default on invalid ISO string", () => {
    const val = schedulingCardValueFromIso("not-a-date", MEL);
    expect(val.mode).toBe("post_now");
  });

  it("AEST (+10): converts 2026-05-23T23:00:00Z → 2026-05-24 09:00", () => {
    // Melbourne is UTC+10 (AEST) in May (southern hemisphere autumn).
    const val = schedulingCardValueFromIso("2026-05-23T23:00:00.000Z", MEL);
    expect(val.mode).toBe("schedule");
    expect(val.scheduledTimes).toHaveLength(1);
    expect(val.scheduledTimes[0]).toEqual({ date: "2026-05-24", time: "09:00" });
  });

  it("AEDT (+11): converts 2026-01-01T22:00:00Z → 2026-01-02 09:00", () => {
    // Melbourne is UTC+11 (AEDT) in January (southern hemisphere summer).
    const val = schedulingCardValueFromIso("2026-01-01T22:00:00.000Z", MEL);
    expect(val.mode).toBe("schedule");
    expect(val.scheduledTimes[0]).toEqual({ date: "2026-01-02", time: "09:00" });
  });

  it("DST boundary: AEDT→AEST transition — first Sunday in April", () => {
    // 2026-04-05 02:59 AEDT is the last moment of DST; clocks fall back to 02:00 AEST.
    // 2026-04-04T16:00:00Z = 2026-04-05 03:00 AEST (after clock fell back).
    const val = schedulingCardValueFromIso("2026-04-04T16:00:00.000Z", MEL);
    expect(val.mode).toBe("schedule");
    expect(val.scheduledTimes[0]!.date).toBe("2026-04-05");
    expect(val.scheduledTimes[0]!.time).toBe("02:00"); // post-fallback AEST time
  });

  it("handles UTC timezone without error", () => {
    const val = schedulingCardValueFromIso("2026-05-23T09:00:00.000Z", "UTC");
    expect(val.mode).toBe("schedule");
    expect(val.scheduledTimes[0]).toEqual({ date: "2026-05-23", time: "09:00" });
  });

  it("preserves other SchedulingCardValue defaults (recurrence, approvalRequired)", () => {
    const val = schedulingCardValueFromIso("2026-05-23T23:00:00.000Z", MEL);
    expect(val.approvalRequired).toBe(false);
    expect(val.recurrence).toBeDefined();
  });
});
