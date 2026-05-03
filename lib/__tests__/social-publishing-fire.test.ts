import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// S1-18 — fireScheduledPublish + claim_publish_job RPC against the
// live Supabase stack with a mocked bundle.social SDK.
//
// Covers:
//   - claim_publish_job RPC outcomes: OK, CANCELLED, INVALID_STATE,
//     NO_CONNECTION, CONNECTION_DEGRADED, ALREADY_CLAIMED.
//   - Successful publish → bundle_post_id stored on attempt; master
//     stays in 'publishing' (webhook flips to 'published' later).
//   - Bundle SDK throw → attempt failed, master flipped to 'failed'.
//   - Bundle SDK returns status='ERROR' → same failure path.
//   - Empty post body short-circuits before bundle.social call.
// ---------------------------------------------------------------------------

const mockClient = {
  post: {
    postCreate: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-test-1",
}));

import { fireScheduledPublish } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa1818";

async function seedCompany(): Promise<void> {
  const svc = getServiceRoleClient();
  const r = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "S1-18 Co",
    slug: "s1-18-co",
    domain: "s1-18.test",
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (r.error) throw new Error(`seed company: ${r.error.message}`);
}

async function seedChain(opts: {
  masterState?: string;
  variantText?: string | null;
  masterText?: string | null;
  connectionStatus?: string;
  withConnection?: boolean;
}): Promise<{ scheduleEntryId: string; masterId: string; attemptIdAfter?: string }> {
  const svc = getServiceRoleClient();

  const master = await svc
    .from("social_post_master")
    .insert({
      company_id: COMPANY_ID,
      state: opts.masterState ?? "approved",
      source_type: "manual",
      master_text: opts.masterText ?? "Hello world",
    })
    .select("id")
    .single();
  if (master.error) throw new Error(`seed master: ${master.error.message}`);

  let connectionId: string | null = null;
  if (opts.withConnection !== false) {
    const conn = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_ID,
        platform: "linkedin_personal",
        bundle_social_account_id: "ba_acct_" + master.data.id.slice(0, 8),
        display_name: "Acme LI",
        status: opts.connectionStatus ?? "healthy",
      })
      .select("id")
      .single();
    if (conn.error) throw new Error(`seed conn: ${conn.error.message}`);
    connectionId = conn.data.id as string;
  }

  const variant = await svc
    .from("social_post_variant")
    .insert({
      post_master_id: master.data.id,
      platform: "linkedin_personal",
      variant_text: opts.variantText ?? null,
      connection_id: connectionId,
    })
    .select("id")
    .single();
  if (variant.error) throw new Error(`seed variant: ${variant.error.message}`);

  const entry = await svc
    .from("social_schedule_entries")
    .insert({
      post_variant_id: variant.data.id,
      scheduled_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (entry.error) throw new Error(`seed entry: ${entry.error.message}`);

  return { scheduleEntryId: entry.data.id as string, masterId: master.data.id as string };
}

beforeEach(async () => {
  mockClient.post.postCreate.mockReset();
  await seedCompany();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("fireScheduledPublish — happy path", () => {
  it("claims, calls bundle.social, stores bundle_post_id; master stays in 'publishing'", async () => {
    const { scheduleEntryId, masterId } = await seedChain({});
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_123",
      status: "SCHEDULED",
    });

    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("ok");
    expect(result.data.bundlePostId).toBe("bp_123");
    expect(result.data.publishAttemptId).toBeTruthy();

    const svc = getServiceRoleClient();
    const attempt = await svc
      .from("social_publish_attempts")
      .select("status, bundle_post_id")
      .eq("id", result.data.publishAttemptId!)
      .single();
    // Webhook (S1-17) flips status to 'succeeded' later; for now still in_flight.
    expect(attempt.data?.status).toBe("in_flight");
    expect(attempt.data?.bundle_post_id).toBe("bp_123");

    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("publishing");
  });

  it("uses variant_text when set, master_text otherwise", async () => {
    const { scheduleEntryId } = await seedChain({
      variantText: "variant-specific copy",
      masterText: "master fallback",
    });
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_v",
      status: "SCHEDULED",
    });

    await fireScheduledPublish({ scheduleEntryId });
    const callArg = mockClient.post.postCreate.mock.calls[0]?.[0];
    expect(callArg?.requestBody?.data?.LINKEDIN?.text).toBe(
      "variant-specific copy",
    );
  });
});

describe("fireScheduledPublish — claim outcomes", () => {
  it("returns cancelled when schedule entry is cancelled", async () => {
    const { scheduleEntryId } = await seedChain({});
    const svc = getServiceRoleClient();
    await svc
      .from("social_schedule_entries")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", scheduleEntryId);

    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("cancelled");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("returns invalid_state when master is not approved/scheduled", async () => {
    const { scheduleEntryId } = await seedChain({ masterState: "draft" });
    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("invalid_state");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("returns no_connection when no connection exists for the platform", async () => {
    const { scheduleEntryId } = await seedChain({ withConnection: false });
    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("no_connection");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("returns connection_degraded when pinned connection is auth_required", async () => {
    const { scheduleEntryId } = await seedChain({
      connectionStatus: "auth_required",
    });
    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("connection_degraded");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("second concurrent fire returns already_claimed", async () => {
    const { scheduleEntryId } = await seedChain({});
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_first",
      status: "SCHEDULED",
    });

    const first = await fireScheduledPublish({ scheduleEntryId });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.outcome).toBe("ok");

    const second = await fireScheduledPublish({ scheduleEntryId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.outcome).toBe("already_claimed");
    // bundle.social was called exactly once.
    expect(mockClient.post.postCreate).toHaveBeenCalledTimes(1);
  });
});

describe("fireScheduledPublish — bundle.social failures", () => {
  it("SDK throw → attempt failed, master 'failed'", async () => {
    const { scheduleEntryId, masterId } = await seedChain({});
    mockClient.post.postCreate.mockRejectedValueOnce(new Error("HTTP 429"));

    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("publish_failed");

    const svc = getServiceRoleClient();
    const attempts = await svc
      .from("social_publish_attempts")
      .select("status, error_class")
      .order("started_at", { ascending: false })
      .limit(1);
    expect(attempts.data?.[0]?.status).toBe("failed");
    expect(attempts.data?.[0]?.error_class).toBe("rate_limit");

    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("failed");
  });

  it("SDK returns status=ERROR → attempt failed", async () => {
    const { scheduleEntryId, masterId } = await seedChain({});
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_err",
      status: "ERROR",
    });

    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("publish_failed");

    const svc = getServiceRoleClient();
    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("failed");
  });

  it("empty post body short-circuits before SDK call", async () => {
    const { scheduleEntryId } = await seedChain({
      variantText: "",
      masterText: "",
    });
    const result = await fireScheduledPublish({ scheduleEntryId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });
});
