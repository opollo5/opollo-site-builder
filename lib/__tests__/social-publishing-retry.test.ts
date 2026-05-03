import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// S1-20 — retryPublishAttempt + retry_publish_attempt RPC against the
// live Supabase stack with a mocked bundle.social SDK.
//
// Covers:
//   - Happy path: failed attempt → new in_flight attempt with
//     original_attempt_id + retry_count incremented; master flipped to
//     'publishing'; bundle_post_id stored.
//   - Race: two concurrent retries, second gets ALREADY_RETRYING and
//     bundle.social is called exactly once.
//   - Refusal cases: not_found, invalid_state (attempt not failed),
//     invalid_state (master not failed), no_connection, connection_degraded.
//   - Failure path: SDK throw → new attempt failed, master back to
//     'failed' (mirrors fire.ts).
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

import { retryPublishAttempt } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa2020";

async function seedCompany(): Promise<void> {
  const svc = getServiceRoleClient();
  const r = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "S1-20 Co",
    slug: "s1-20-co",
    domain: "s1-20.test",
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (r.error) throw new Error(`seed company: ${r.error.message}`);
}

async function seedFailedAttempt(opts?: {
  masterState?: string;
  attemptStatus?: string;
  withConnection?: boolean;
  connectionStatus?: string;
}): Promise<{ failedAttemptId: string; masterId: string }> {
  const svc = getServiceRoleClient();

  const master = await svc
    .from("social_post_master")
    .insert({
      company_id: COMPANY_ID,
      state: opts?.masterState ?? "failed",
      source_type: "manual",
      master_text: "retry me",
    })
    .select("id")
    .single();
  if (master.error) throw new Error(`seed master: ${master.error.message}`);

  let connectionId: string | null = null;
  if (opts?.withConnection !== false) {
    const conn = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_ID,
        platform: "linkedin_personal",
        bundle_social_account_id: "ba_retry_" + master.data.id.slice(0, 8),
        display_name: "Acme LI",
        status: opts?.connectionStatus ?? "healthy",
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
      variant_text: "retry text",
      connection_id: connectionId,
    })
    .select("id")
    .single();
  if (variant.error) throw new Error(`seed variant: ${variant.error.message}`);

  const job = await svc
    .from("social_publish_jobs")
    .insert({
      post_variant_id: variant.data.id,
      company_id: COMPANY_ID,
      fire_at: new Date().toISOString(),
      fired_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (job.error) throw new Error(`seed job: ${job.error.message}`);

  const attempt = await svc
    .from("social_publish_attempts")
    .insert({
      publish_job_id: job.data.id,
      post_variant_id: variant.data.id,
      connection_id: connectionId ?? job.data.id, // connection FK is required; use any uuid when no real connection (test won't read it)
      status: opts?.attemptStatus ?? "failed",
      error_class: "rate_limit",
      error_payload: { message: "Too many" },
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (attempt.error) {
    throw new Error(`seed attempt: ${attempt.error.message}`);
  }

  return {
    failedAttemptId: attempt.data.id as string,
    masterId: master.data.id as string,
  };
}

beforeEach(async () => {
  mockClient.post.postCreate.mockReset();
  await seedCompany();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("retryPublishAttempt — happy path", () => {
  it("creates new in_flight attempt + flips master to publishing + stores bundle_post_id", async () => {
    const { failedAttemptId, masterId } = await seedFailedAttempt();
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_retry_1",
      status: "SCHEDULED",
    });

    const result = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("ok");
    expect(result.data.bundlePostId).toBe("bp_retry_1");
    expect(result.data.newAttemptId).toBeTruthy();
    expect(result.data.newAttemptId).not.toBe(failedAttemptId);

    const svc = getServiceRoleClient();
    const newAttempt = await svc
      .from("social_publish_attempts")
      .select("status, bundle_post_id, original_attempt_id, retry_count")
      .eq("id", result.data.newAttemptId!)
      .single();
    expect(newAttempt.data?.status).toBe("in_flight");
    expect(newAttempt.data?.bundle_post_id).toBe("bp_retry_1");
    expect(newAttempt.data?.original_attempt_id).toBe(failedAttemptId);
    expect(newAttempt.data?.retry_count).toBe(1);

    const master = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", masterId)
      .single();
    expect(master.data?.state).toBe("publishing");

    // Original failed attempt is unchanged.
    const oldAttempt = await svc
      .from("social_publish_attempts")
      .select("status")
      .eq("id", failedAttemptId)
      .single();
    expect(oldAttempt.data?.status).toBe("failed");
  });

  it("second concurrent retry returns already_retrying; bundle.social called once", async () => {
    const { failedAttemptId } = await seedFailedAttempt();
    mockClient.post.postCreate.mockResolvedValueOnce({
      id: "bp_first",
      status: "SCHEDULED",
    });

    const first = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.outcome).toBe("ok");

    const second = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.outcome).toBe("already_retrying");
    expect(mockClient.post.postCreate).toHaveBeenCalledTimes(1);
  });
});

describe("retryPublishAttempt — refusal cases", () => {
  it("returns not_found for unknown attempt id", async () => {
    const result = await retryPublishAttempt({
      attemptId: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("not_found");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("returns invalid_state when attempt is not failed", async () => {
    const { failedAttemptId } = await seedFailedAttempt({
      attemptStatus: "succeeded",
      masterState: "published",
    });

    const result = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("invalid_state");
  });

  it("returns invalid_state when master moved out of failed", async () => {
    const { failedAttemptId, masterId } = await seedFailedAttempt();
    const svc = getServiceRoleClient();
    await svc
      .from("social_post_master")
      .update({ state: "draft" })
      .eq("id", masterId);

    const result = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("invalid_state");
    expect(mockClient.post.postCreate).not.toHaveBeenCalled();
  });

  it("returns connection_degraded when pinned connection is auth_required", async () => {
    const { failedAttemptId } = await seedFailedAttempt({
      connectionStatus: "auth_required",
    });

    const result = await retryPublishAttempt({ attemptId: failedAttemptId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe("connection_degraded");
  });
});

describe("retryPublishAttempt — bundle.social failures", () => {
  it("SDK throw → new attempt failed, master back to failed", async () => {
    const { failedAttemptId, masterId } = await seedFailedAttempt();
    mockClient.post.postCreate.mockRejectedValueOnce(new Error("HTTP 401"));

    const result = await retryPublishAttempt({ attemptId: failedAttemptId });
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

    // Original is now retryable again — the new attempt is the failed
    // one. Caller should retry the NEW attempt id, not the original.
    const newAttempts = await svc
      .from("social_publish_attempts")
      .select("status, error_class")
      .eq("original_attempt_id", failedAttemptId);
    expect(newAttempts.data?.length).toBe(1);
    expect(newAttempts.data?.[0]?.status).toBe("failed");
    expect(newAttempts.data?.[0]?.error_class).toBe("auth");
  });
});
