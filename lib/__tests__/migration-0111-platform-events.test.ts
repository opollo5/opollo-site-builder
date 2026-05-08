import { describe, expect, it, beforeEach } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Migration 0111 -- platform_events table.
//
// Verifies:
//   1. Happy-path insert for each major event_type category.
//   2. CHECK constraint rejects unknown event_type values.
//   3. notification_channel CHECK rejects invalid values.
//   4. Dedup query returns correct rows within the dedup window.
//   5. All valid event_type values are accepted.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001110-0000-0000-0000-000000000001";

describe("migration 0111 -- platform_events", () => {
  beforeEach(async () => {
    const svc = getServiceRoleClient();
    await svc.from("platform_events").delete().eq("company_id", COMPANY_ID);
    await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
    await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "Events Test Co",
        slug: "m0111-events-test",
        domain: "m0111-events.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      });
  });

  it("inserts a compose_opened event", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("platform_events").insert({
      company_id: COMPANY_ID,
      event_type: "compose_opened",
      payload: { source: "calendar" },
    });
    expect(error).toBeNull();
  });

  it("inserts a connection_broken event with notification tracking", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("platform_events")
      .insert({
        company_id: COMPANY_ID,
        event_type: "connection_broken",
        entity_type: "social_connection",
        entity_id: "11111111-0000-0000-0000-000000000001",
        notification_channel: "both",
        notification_sent_at: null,
      })
      .select("id, notification_sent_at")
      .single();
    expect(error).toBeNull();
    expect(data!.notification_sent_at).toBeNull();
  });

  it("rejects an unknown event_type via CHECK constraint", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("platform_events").insert({
      company_id: COMPANY_ID,
      event_type: "unknown_event_xyz",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("rejects an invalid notification_channel via CHECK constraint", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("platform_events").insert({
      company_id: COMPANY_ID,
      event_type: "notification_emitted",
      notification_channel: "sms",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("dedup query: finds rows within window, misses rows outside window", async () => {
    const svc = getServiceRoleClient();
    const entityId = "22222222-0000-0000-0000-000000000001";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    await svc.from("platform_events").insert([
      {
        company_id: COMPANY_ID,
        event_type: "connection_broken",
        entity_id: entityId,
        notification_sent_at: oneHourAgo,
      },
      {
        company_id: COMPANY_ID,
        event_type: "publish_failed",
        entity_id: entityId,
        notification_sent_at: twoHoursAgo,
      },
    ]);

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: inWindow } = await svc
      .from("platform_events")
      .select("id")
      .eq("event_type", "connection_broken")
      .eq("entity_id", entityId)
      .gt("notification_sent_at", twentyFourHoursAgo)
      .limit(1);
    expect(inWindow).toHaveLength(1);

    const oneHourAgoTs = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const { data: outsideWindow } = await svc
      .from("platform_events")
      .select("id")
      .eq("event_type", "publish_failed")
      .eq("entity_id", entityId)
      .gt("notification_sent_at", oneHourAgoTs)
      .limit(1);
    expect(outsideWindow).toHaveLength(0);
  });

  it("accepts all valid event_type values", async () => {
    const svc = getServiceRoleClient();
    const validTypes = [
      "compose_opened", "compose_closed",
      "draft_saved", "draft_save_failed", "draft_recovered", "draft_conflict",
      "publish_started", "publish_succeeded", "publish_failed",
      "ai_generated", "ai_failed",
      "reconnect_started", "reconnect_completed",
      "connection_broken", "connection_expired", "connection_pre_expiry",
      "notification_emitted",
      "approval_requested", "approval_granted", "approval_rejected",
    ] as const;

    for (const eventType of validTypes) {
      const { error } = await svc.from("platform_events").insert({
        company_id: COMPANY_ID,
        event_type: eventType,
      });
      expect(error, `event_type '${eventType}' should be accepted`).toBeNull();
    }
  });
});
