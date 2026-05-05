import { beforeEach, describe, expect, it } from "vitest";

import { processBundlesocialWebhook } from "@/lib/platform/social/webhooks";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-17 — webhook processor against the live Supabase stack.
//
// Covers:
//   - Idempotent insert: duplicate event_id short-circuits to
//     already_processed once the first delivery stamped processed_at.
//   - Stored-no-action for unknown event types.
//   - post.published / post.failed flip publish_attempt + master state
//     when the matching bundle_post_id exists; stored_no_action when
//     it doesn't.
//   - social-account.disconnected / .auth-required update connection
//     status + insert a connection_alert row.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa1717";

async function seedCompany(): Promise<void> {
  const svc = getServiceRoleClient();
  const r = await svc.from("platform_companies").insert({
    id: COMPANY_A_ID,
    name: "S1-17 Co",
    slug: "s1-17-co",
    domain: "s1-17.test",
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (r.error) throw new Error(`seed company: ${r.error.message}`);
}

async function seedConnection(bundleAccountId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const r = await svc
    .from("social_connections")
    .insert({
      company_id: COMPANY_A_ID,
      platform: "linkedin_personal",
      bundle_social_account_id: bundleAccountId,
      display_name: "Acme LI",
      status: "healthy",
    })
    .select("id")
    .single();
  if (r.error) throw new Error(`seed connection: ${r.error.message}`);
  return r.data.id as string;
}

async function seedPublishChain(
  bundlePostId: string,
): Promise<{ attemptId: string; variantId: string; masterId: string }> {
  const svc = getServiceRoleClient();
  const master = await svc
    .from("social_post_master")
    .insert({
      company_id: COMPANY_A_ID,
      title: "Test post",
      state: "publishing",
      source: "manual",
    })
    .select("id")
    .single();
  if (master.error) throw new Error(`seed master: ${master.error.message}`);

  const variant = await svc
    .from("social_post_variant")
    .insert({
      post_master_id: master.data.id,
      platform: "linkedin_personal",
      variant_text: "hello",
    })
    .select("id")
    .single();
  if (variant.error) throw new Error(`seed variant: ${variant.error.message}`);

  const conn = await seedConnection("ba_pub_" + bundlePostId);

  const job = await svc
    .from("social_publish_jobs")
    .insert({
      post_variant_id: variant.data.id,
      company_id: COMPANY_A_ID,
      fire_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (job.error) throw new Error(`seed job: ${job.error.message}`);

  const attempt = await svc
    .from("social_publish_attempts")
    .insert({
      publish_job_id: job.data.id,
      post_variant_id: variant.data.id,
      connection_id: conn,
      bundle_post_id: bundlePostId,
      status: "in_flight",
    })
    .select("id")
    .single();
  if (attempt.error) {
    throw new Error(`seed attempt: ${attempt.error.message}`);
  }

  return {
    attemptId: attempt.data.id as string,
    variantId: variant.data.id as string,
    masterId: master.data.id as string,
  };
}

beforeEach(async () => {
  await seedCompany();
});

describe("processBundlesocialWebhook — envelope + idempotency", () => {
  it("stores an unrecognised event and stamps processed_at", async () => {
    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_unrecognised_1",
        type: "team.something.else",
        data: {},
      },
      rawPayload: { id: "evt_unrecognised_1", type: "team.something.else" },
      signatureValid: true,
    });
    expect(result.kind).toBe("stored_no_action");

    const svc = getServiceRoleClient();
    const row = await svc
      .from("social_webhook_events")
      .select("processed_at, signature_valid")
      .eq("event_id", "evt_unrecognised_1")
      .single();
    expect(row.data?.processed_at).not.toBeNull();
    expect(row.data?.signature_valid).toBe(true);
  });

  it("short-circuits to already_processed on duplicate delivery", async () => {
    const envelope = {
      id: "evt_dup_1",
      type: "team.heartbeat",
      data: {},
    };
    const first = await processBundlesocialWebhook({
      envelope,
      rawPayload: envelope,
      signatureValid: true,
    });
    expect(first.kind).toBe("stored_no_action");

    const second = await processBundlesocialWebhook({
      envelope,
      rawPayload: envelope,
      signatureValid: true,
    });
    expect(second.kind).toBe("already_processed");
  });
});

describe("processBundlesocialWebhook — post events", () => {
  it("post.published flips attempt to succeeded + master to published", async () => {
    const { attemptId, masterId } = await seedPublishChain("bp_published_1");

    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_post_pub_1",
        type: "post.published",
        data: {
          bundlePostId: "bp_published_1",
          platformPostUrl: "https://linkedin.com/posts/abc",
        },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.action).toBe("post_published");

    const svc = getServiceRoleClient();
    const attempt = await svc
      .from("social_publish_attempts")
      .select("status, platform_post_url, completed_at")
      .eq("id", attemptId)
      .single();
    expect(attempt.data?.status).toBe("succeeded");
    expect(attempt.data?.platform_post_url).toBe(
      "https://linkedin.com/posts/abc",
    );
    expect(attempt.data?.completed_at).not.toBeNull();

    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("published");
  });

  it("post.failed flips attempt to failed with mapped error_class + master to failed", async () => {
    const { attemptId, masterId } = await seedPublishChain("bp_failed_1");

    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_post_fail_1",
        type: "post.failed",
        data: {
          bundlePostId: "bp_failed_1",
          error: {
            class: "rate_limit",
            message: "Too many posts",
          },
        },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.action).toBe("post_failed");

    const svc = getServiceRoleClient();
    const attempt = await svc
      .from("social_publish_attempts")
      .select("status, error_class, completed_at")
      .eq("id", attemptId)
      .single();
    expect(attempt.data?.status).toBe("failed");
    expect(attempt.data?.error_class).toBe("rate_limit");
    expect(attempt.data?.completed_at).not.toBeNull();

    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("failed");
  });

  it("post.published with no matching bundle_post_id stores without action", async () => {
    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_post_orphan_1",
        type: "post.published",
        data: { bundlePostId: "bp_does_not_exist" },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("stored_no_action");
  });
});

describe("processBundlesocialWebhook — account events", () => {
  it("social-account.disconnected flips connection + inserts alert", async () => {
    const connectionId = await seedConnection("ba_acct_disc_1");

    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_acct_disc_1",
        type: "social-account.disconnected",
        data: {
          socialAccountId: "ba_acct_disc_1",
          reason: "User revoked permissions",
        },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.action).toBe("account_disconnected");

    const svc = getServiceRoleClient();
    const conn = await svc
      .from("social_connections")
      .select("status, last_error, disconnected_at")
      .eq("id", connectionId)
      .single();
    expect(conn.data?.status).toBe("disconnected");
    expect(conn.data?.last_error).toBe("User revoked permissions");
    expect(conn.data?.disconnected_at).not.toBeNull();

    const alerts = await svc
      .from("social_connection_alerts")
      .select("severity, message")
      .eq("connection_id", connectionId);
    expect(alerts.data?.length).toBe(1);
    expect(alerts.data?.[0]?.severity).toBe("error");
    expect(alerts.data?.[0]?.message).toBe("User revoked permissions");
  });

  it("social-account.auth-required flips connection to auth_required + warning alert", async () => {
    const connectionId = await seedConnection("ba_acct_auth_1");

    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_acct_auth_1",
        type: "social-account.auth-required",
        data: { socialAccountId: "ba_acct_auth_1" },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.action).toBe("account_auth_required");

    const svc = getServiceRoleClient();
    const conn = await svc
      .from("social_connections")
      .select("status, last_error, disconnected_at")
      .eq("id", connectionId)
      .single();
    expect(conn.data?.status).toBe("auth_required");
    expect(conn.data?.disconnected_at).toBeNull();

    const alerts = await svc
      .from("social_connection_alerts")
      .select("severity")
      .eq("connection_id", connectionId);
    expect(alerts.data?.length).toBe(1);
    expect(alerts.data?.[0]?.severity).toBe("warning");
  });

  it("social-account.connected refreshes status when previously degraded", async () => {
    const svc = getServiceRoleClient();
    const seed = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_A_ID,
        platform: "x",
        bundle_social_account_id: "ba_acct_recover_1",
        display_name: "Acme X",
        status: "auth_required",
        last_error: "Token expired",
      })
      .select("id")
      .single();
    expect(seed.error).toBeNull();

    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_acct_recover_1",
        type: "social-account.connected",
        data: { socialAccountId: "ba_acct_recover_1" },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.action).toBe("account_connected");

    const conn = await svc
      .from("social_connections")
      .select("status, last_error")
      .eq("id", seed.data?.id)
      .single();
    expect(conn.data?.status).toBe("healthy");
    expect(conn.data?.last_error).toBeNull();
  });

  it("account event with no matching connection stores without action", async () => {
    const result = await processBundlesocialWebhook({
      envelope: {
        id: "evt_acct_orphan_1",
        type: "social-account.disconnected",
        data: { socialAccountId: "ba_does_not_exist" },
      },
      rawPayload: {},
      signatureValid: true,
    });
    expect(result.kind).toBe("stored_no_action");
  });
});
