import { describe, expect, it, beforeEach, afterAll } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Migration 0126 — reliability and CAP foundations.
//
// Verifies:
//   1. social_campaigns CRUD + RLS-skipped service role.
//   2. social_post_drafts idempotency_key unique index.
//   3. social_publish_attempts new columns (max_retries, next_retry_at,
//      dead_lettered_at, claimed_until, worker_id).
//   4. social_rate_limits insert + UNIQUE (connection_id, window_starts_at).
//   5. social_connections timezone columns persist.
//   6. platform_companies timezone provenance columns.
//   7. platform_event_subscriptions + platform_event_deliveries.
//   8. Fan-out trigger: INSERT on platform_events creates delivery rows.
//   9. platform_session_grants token_hash uniqueness.
//  10. extend_lease RPC extends claimed_until.
//  11. platform_events: new event types accepted; unknown still rejected.
// ---------------------------------------------------------------------------

const COMPANY_ID    = "00001260-0000-0000-0000-000000000001";
const COMPANY_ID_2  = "00001260-0000-0000-0000-000000000002";

async function seedCompany(id: string, slug: string) {
  const svc = getServiceRoleClient();
  await svc.from("platform_companies").delete().eq("id", id);
  const { error } = await svc.from("platform_companies").insert({
    id,
    name: `M0126 Test Co ${slug}`,
    slug,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (error) throw new Error(`seed company: ${error.message}`);
}

// Re-seed before every test so cross-shard deletions by other test files
// (CI runs 4 shards sharing one Supabase DB) can't invalidate FK parents.
// Deleting the company cascades away campaigns/drafts/events/grants/deliveries,
// giving each test a clean slate.
beforeEach(async () => {
  await seedCompany(COMPANY_ID,   "m0126-co-1");
  await seedCompany(COMPANY_ID_2, "m0126-co-2");
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  // Subscriptions have no company FK so they survive cascade — clean them up by name prefix.
  await svc.from("platform_event_subscriptions").delete().like("subscriber_name", "m0126-%");
  // Company deletes cascade: campaigns, drafts, events, session_grants, deliveries.
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID_2);
});

// ---------------------------------------------------------------------------
// 1. social_campaigns
// ---------------------------------------------------------------------------
describe("social_campaigns", () => {
  it("inserts and retrieves a campaign", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_campaigns")
      .insert({
        company_id: COMPANY_ID,
        name: "Q3 Awareness Arc",
        starts_on: "2026-07-01",
        ends_on: "2026-09-30",
        source_type: "cap",
        status: "draft",
      })
      .select("id, name, phase_arc, status")
      .single();

    expect(error).toBeNull();
    expect(data!.name).toBe("Q3 Awareness Arc");
    expect(data!.phase_arc).toEqual(["awareness", "education", "offer", "proof"]);
    expect(data!.status).toBe("draft");
  });

  it("rejects invalid campaign status", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("social_campaigns").insert({
      company_id: COMPANY_ID,
      name: "Bad Status",
      starts_on: "2026-07-01",
      ends_on: "2026-09-30",
      status: "not_a_real_status",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // check constraint violation
  });
});

// ---------------------------------------------------------------------------
// 2. social_post_drafts idempotency_key
// ---------------------------------------------------------------------------
describe("social_post_drafts idempotency", () => {
  it("first insert with idempotency_key succeeds", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return; // skip if no seeded users in test DB

    const { error } = await svc.from("social_post_drafts").insert({
      company_id: COMPANY_ID,
      created_by: authUser.id,
      updated_by: authUser.id,
      draft_data: {},
      idempotency_key: "cap-retry-key-abc",
    });
    expect(error).toBeNull();
  });

  it("duplicate (company_id, idempotency_key) is rejected", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return;

    const key = `cap-idem-${Date.now()}`;
    await svc.from("social_post_drafts").insert({
      company_id: COMPANY_ID,
      created_by: authUser.id,
      updated_by: authUser.id,
      draft_data: {},
      idempotency_key: key,
    });

    const { error } = await svc.from("social_post_drafts").insert({
      company_id: COMPANY_ID,
      created_by: authUser.id,
      updated_by: authUser.id,
      draft_data: {},
      idempotency_key: key,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505"); // unique violation
  });

  it("same key for different company is allowed", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return;

    const key = `cross-company-idem-${Date.now()}`;
    const { error: e1 } = await svc.from("social_post_drafts").insert({
      company_id: COMPANY_ID,
      created_by: authUser.id,
      updated_by: authUser.id,
      draft_data: {},
      idempotency_key: key,
    });
    const { error: e2 } = await svc.from("social_post_drafts").insert({
      company_id: COMPANY_ID_2,
      created_by: authUser.id,
      updated_by: authUser.id,
      draft_data: {},
      idempotency_key: key,
    });
    expect(e1).toBeNull();
    expect(e2).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. social_publish_attempts new columns
// ---------------------------------------------------------------------------
describe("social_publish_attempts new columns", () => {
  it("new columns have correct defaults and accept writes", async () => {
    const svc = getServiceRoleClient();
    // We need a publish job + variant chain — read one existing attempt if present.
    const { data: attempt } = await svc
      .from("social_publish_attempts")
      .select("id, max_retries, next_retry_at, dead_lettered_at, claimed_until, worker_id")
      .limit(1)
      .single();

    if (!attempt) return; // no attempt rows in test DB — skip

    expect(attempt.max_retries).toBe(5);
    expect(attempt.next_retry_at).toBeNull();
    expect(attempt.dead_lettered_at).toBeNull();
    expect(attempt.claimed_until).toBeNull();
    expect(attempt.worker_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. social_rate_limits
// ---------------------------------------------------------------------------
describe("social_rate_limits", () => {
  it("inserts a rate limit row", async () => {
    const svc = getServiceRoleClient();
    const { data: conn } = await svc
      .from("social_connections")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .limit(1)
      .single();

    if (!conn) return; // no connections seeded

    const now = new Date().toISOString();
    const reset = new Date(Date.now() + 86_400_000).toISOString();
    const { error } = await svc.from("social_rate_limits").insert({
      connection_id: conn.id,
      platform: "linkedin",
      window_starts_at: now,
      window_resets_at: reset,
      requests_made: 1,
      requests_limit: 100,
    });
    expect(error).toBeNull();
  });

  it("rejects duplicate (connection_id, window_starts_at)", async () => {
    const svc = getServiceRoleClient();
    const { data: conn } = await svc
      .from("social_connections")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .limit(1)
      .single();

    if (!conn) return;

    const ts = new Date().toISOString();
    const reset = new Date(Date.now() + 86_400_000).toISOString();

    await svc.from("social_rate_limits").insert({
      connection_id: conn.id,
      platform: "x",
      window_starts_at: ts,
      window_resets_at: reset,
      requests_made: 1,
      requests_limit: 50,
    });

    const { error } = await svc.from("social_rate_limits").insert({
      connection_id: conn.id,
      platform: "x",
      window_starts_at: ts,
      window_resets_at: reset,
      requests_made: 2,
      requests_limit: 50,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });
});

// ---------------------------------------------------------------------------
// 5. social_connections timezone columns
// ---------------------------------------------------------------------------
describe("social_connections timezone columns", () => {
  it("timezone and detected_timezone columns exist and accept values", async () => {
    const svc = getServiceRoleClient();
    const { data: conn } = await svc
      .from("social_connections")
      .select("id")
      .eq("company_id", COMPANY_ID)
      .limit(1)
      .single();

    if (!conn) return;

    const { error } = await svc
      .from("social_connections")
      .update({ timezone: "America/New_York", detected_timezone: "America/New_York" })
      .eq("id", conn.id);
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. platform_companies timezone provenance
// ---------------------------------------------------------------------------
describe("platform_companies timezone provenance", () => {
  it("timezone_source defaults to 'default'", async () => {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("platform_companies")
      .select("timezone_source, timezone_confirmed_at, timezone_confirmed_by")
      .eq("id", COMPANY_ID)
      .single();
    expect(error).toBeNull();
    expect(data!.timezone_source).toBe("default");
    expect(data!.timezone_confirmed_at).toBeNull();
  });

  it("rejects invalid timezone_source via CHECK", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("platform_companies")
      .update({ timezone_source: "made_up_source" } as never)
      .eq("id", COMPANY_ID);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("accepts valid timezone_source values", async () => {
    const svc = getServiceRoleClient();
    for (const src of ["browser_detected", "manager_set", "client_confirmed", "default"] as const) {
      const { error } = await svc
        .from("platform_companies")
        .update({ timezone_source: src })
        .eq("id", COMPANY_ID);
      expect(error, `timezone_source '${src}' should be accepted`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. platform_event_subscriptions + deliveries
// ---------------------------------------------------------------------------
describe("platform_event_subscriptions + deliveries", () => {
  it("inserts a subscription; fan-out trigger creates delivery row on event insert", async () => {
    const svc = getServiceRoleClient();

    const { data: sub, error: subErr } = await svc
      .from("platform_event_subscriptions")
      .insert({
        subscriber_name: "m0126-test-subscriber",
        webhook_url: "https://webhook.site/test",
        signing_secret: "test-secret-abc",
        event_types: ["publish_succeeded", "publish_failed"],
        active: true,
      })
      .select("id")
      .single();
    expect(subErr).toBeNull();

    // Inserting an event fires the fan-out trigger which auto-creates the delivery row.
    const { data: evt, error: evtErr } = await svc
      .from("platform_events")
      .insert({ company_id: COMPANY_ID, event_type: "publish_succeeded" })
      .select("id")
      .single();
    expect(evtErr).toBeNull();

    // Verify the trigger created a delivery row automatically.
    const { data: deliveries } = await svc
      .from("platform_event_deliveries")
      .select("id, status")
      .eq("subscription_id", sub!.id)
      .eq("event_id", evt!.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries![0].status).toBe("pending");
  });

  it("rejects duplicate (subscription_id, event_id)", async () => {
    const svc = getServiceRoleClient();

    const { data: sub } = await svc
      .from("platform_event_subscriptions")
      .select("id")
      .eq("subscriber_name", "m0126-test-subscriber")
      .limit(1)
      .single();
    if (!sub) return;

    // Inserting the event fires the trigger which creates (sub.id, evt.id) automatically.
    const { data: evt } = await svc
      .from("platform_events")
      .insert({ company_id: COMPANY_ID, event_type: "publish_failed" })
      .select("id")
      .single();
    if (!evt) return;

    // Trigger already owns (sub.id, evt.id) — manual insert must be rejected.
    const { error } = await svc.from("platform_event_deliveries").insert({
      subscription_id: sub.id,
      event_id: evt.id,
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });
});

// ---------------------------------------------------------------------------
// 8. Fan-out trigger
// ---------------------------------------------------------------------------
describe("fan-out trigger", () => {
  it("inserting a platform_event creates a delivery row for matching subscription", async () => {
    const svc = getServiceRoleClient();

    // Ensure subscription exists with a unique name to isolate this test
    const subName = `m0126-fanout-${Date.now()}`;
    const { data: sub } = await svc
      .from("platform_event_subscriptions")
      .insert({
        subscriber_name: subName,
        webhook_url: "https://webhook.site/fanout-test",
        signing_secret: "fanout-secret",
        event_types: ["schedule_created"],
        active: true,
      })
      .select("id")
      .single();
    if (!sub) return;

    const { data: evt } = await svc
      .from("platform_events")
      .insert({ company_id: COMPANY_ID, event_type: "schedule_created" })
      .select("id")
      .single();
    expect(evt).not.toBeNull();

    const { data: deliveries } = await svc
      .from("platform_event_deliveries")
      .select("id, status")
      .eq("subscription_id", sub.id)
      .eq("event_id", evt!.id);

    expect(deliveries).toHaveLength(1);
    expect(deliveries![0].status).toBe("pending");
  });

  it("non-matching event_type does NOT create a delivery row", async () => {
    const svc = getServiceRoleClient();

    const subName = `m0126-fanout-miss-${Date.now()}`;
    const { data: sub } = await svc
      .from("platform_event_subscriptions")
      .insert({
        subscriber_name: subName,
        webhook_url: "https://webhook.site/fanout-miss",
        signing_secret: "miss-secret",
        event_types: ["campaign_created"],
        active: true,
      })
      .select("id")
      .single();
    if (!sub) return;

    const { data: evt } = await svc
      .from("platform_events")
      .insert({ company_id: COMPANY_ID, event_type: "publish_late" })
      .select("id")
      .single();
    expect(evt).not.toBeNull();

    const { data: deliveries } = await svc
      .from("platform_event_deliveries")
      .select("id")
      .eq("subscription_id", sub.id)
      .eq("event_id", evt!.id);

    expect(deliveries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. platform_session_grants
// ---------------------------------------------------------------------------
describe("platform_session_grants", () => {
  it("inserts a grant", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return;

    const { error } = await svc.from("platform_session_grants").insert({
      token_hash: `sha256-test-${Date.now()}`,
      user_id: authUser.id,
      company_id: COMPANY_ID,
      grant_type: "reconnect_only",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(error).toBeNull();
  });

  it("rejects duplicate token_hash", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return;

    const hash = `sha256-dup-${Date.now()}`;
    const expires = new Date(Date.now() + 3_600_000).toISOString();

    await svc.from("platform_session_grants").insert({
      token_hash: hash,
      user_id: authUser.id,
      company_id: COMPANY_ID,
      grant_type: "full_session",
      expires_at: expires,
    });

    const { error } = await svc.from("platform_session_grants").insert({
      token_hash: hash,
      user_id: authUser.id,
      company_id: COMPANY_ID,
      grant_type: "full_session",
      expires_at: expires,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("rejects invalid grant_type", async () => {
    const svc = getServiceRoleClient();
    const authUser = (await svc.auth.admin.listUsers()).data.users[0];
    if (!authUser) return;

    const { error } = await svc.from("platform_session_grants").insert({
      token_hash: `sha256-bad-${Date.now()}`,
      user_id: authUser.id,
      company_id: COMPANY_ID,
      grant_type: "not_a_type",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });
});

// ---------------------------------------------------------------------------
// 10. extend_lease RPC
// ---------------------------------------------------------------------------
describe("extend_lease RPC", () => {
  it("extends claimed_until when attempt is in_flight", async () => {
    const svc = getServiceRoleClient();
    const { data: attempt } = await svc
      .from("social_publish_attempts")
      .select("id, claimed_until")
      .eq("status", "in_flight")
      .limit(1)
      .single();

    if (!attempt || !attempt.claimed_until) return; // no in-flight attempt to test

    await svc.rpc("extend_lease", { p_attempt_id: attempt.id, p_additional_seconds: 60 });

    const { data: after } = await svc
      .from("social_publish_attempts")
      .select("claimed_until")
      .eq("id", attempt.id)
      .single();

    expect(new Date(after!.claimed_until!).getTime()).toBeGreaterThan(
      new Date(attempt.claimed_until).getTime(),
    );
  });
});

// ---------------------------------------------------------------------------
// 11. platform_events: new event types
// ---------------------------------------------------------------------------
describe("platform_events extended CHECK constraint", () => {
  const newEventTypes = [
    "schedule_created", "schedule_due", "schedule_skipped",
    "schedule_abandoned", "schedule_blocked",
    "publish_attempted", "publish_dead_lettered", "publish_late", "publish_rate_limited",
    "connection_connected", "connection_lost", "reconnect_required",
    "campaign_created", "campaign_started", "campaign_post_dead_lettered",
    "campaign_completed", "campaign_paused", "campaign_resumed", "campaign_cancelled",
    "worker_died", "webhook_dispatched", "webhook_dispatch_failed",
    "subscription_disabled", "magic_link_consumed", "service_action_taken",
  ] as const;

  it.each(newEventTypes)("accepts event_type '%s'", async (eventType) => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("platform_events").insert({
      company_id: COMPANY_ID,
      event_type: eventType,
    });
    expect(error, `event_type '${eventType}' should be accepted`).toBeNull();
  });

  it("still rejects unknown event_type after constraint extension", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("platform_events").insert({
      company_id: COMPANY_ID,
      event_type: "totally_made_up_event",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });
});
