import { beforeEach, describe, expect, it } from "vitest";

import { listPublishAttempts } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-21 — listPublishAttempts against the live Supabase stack.
//
// Covers:
//   - Empty result for a post with no variants.
//   - Returns attempts ordered by started_at desc.
//   - Joins variant.platform onto each attempt.
//   - Cross-company isolation: attempts under another company's job
//     are filtered out.
// ---------------------------------------------------------------------------

const COMPANY_A = "abcdef00-0000-0000-0000-aaaaaaaa2121";
const COMPANY_B = "abcdef00-0000-0000-0000-bbbbbbbb2121";

async function seedCompanies(): Promise<void> {
  const svc = getServiceRoleClient();
  for (const [id, slug] of [
    [COMPANY_A, "s1-21-a"],
    [COMPANY_B, "s1-21-b"],
  ] as const) {
    const r = await svc.from("platform_companies").insert({
      id,
      name: `S1-21 ${slug}`,
      slug,
      domain: `${slug}.test`,
      is_opollo_internal: false,
      timezone: "Australia/Melbourne",
      approval_default_rule: "any_one",
    });
    if (r.error) throw new Error(`seed company ${slug}: ${r.error.message}`);
  }
}

async function seedAttempt(opts: {
  companyId: string;
  startedAt: string;
  status?: string;
  platform?: string;
  postMasterId?: string;
}): Promise<{ attemptId: string; postId: string }> {
  const svc = getServiceRoleClient();

  const masterId = opts.postMasterId;
  let masterRow: { id: string };
  if (masterId) {
    masterRow = { id: masterId };
  } else {
    const master = await svc
      .from("social_post_master")
      .insert({
        company_id: opts.companyId,
        state: "publishing",
        source_type: "manual",
        master_text: "test",
      })
      .select("id")
      .single();
    if (master.error) throw new Error(`seed master: ${master.error.message}`);
    masterRow = { id: master.data.id as string };
  }

  const variant = await svc
    .from("social_post_variant")
    .insert({
      post_master_id: masterRow.id,
      platform: opts.platform ?? "linkedin_personal",
    })
    .select("id")
    .single();
  if (variant.error) throw new Error(`seed variant: ${variant.error.message}`);

  const conn = await svc
    .from("social_connections")
    .insert({
      company_id: opts.companyId,
      platform: opts.platform ?? "linkedin_personal",
      bundle_social_account_id: "ba_" + variant.data.id.slice(0, 8),
      status: "healthy",
    })
    .select("id")
    .single();
  if (conn.error) throw new Error(`seed conn: ${conn.error.message}`);

  const job = await svc
    .from("social_publish_jobs")
    .insert({
      post_variant_id: variant.data.id,
      company_id: opts.companyId,
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
      connection_id: conn.data.id,
      status: opts.status ?? "succeeded",
      started_at: opts.startedAt,
      completed_at: opts.startedAt,
    })
    .select("id")
    .single();
  if (attempt.error) {
    throw new Error(`seed attempt: ${attempt.error.message}`);
  }

  return {
    attemptId: attempt.data.id as string,
    postId: masterRow.id,
  };
}

beforeEach(async () => {
  await seedCompanies();
});

describe("listPublishAttempts", () => {
  it("returns empty for a post with no variants", async () => {
    const svc = getServiceRoleClient();
    const master = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_A,
        state: "publishing",
        source_type: "manual",
        master_text: "lonely",
      })
      .select("id")
      .single();

    const result = await listPublishAttempts({
      postMasterId: master.data!.id as string,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.attempts).toEqual([]);
  });

  it("returns attempts ordered by started_at desc with platform joined", async () => {
    const earlier = "2026-04-01T10:00:00Z";
    const later = "2026-04-02T10:00:00Z";

    const first = await seedAttempt({
      companyId: COMPANY_A,
      startedAt: earlier,
      status: "failed",
      platform: "linkedin_personal",
    });
    // Second attempt under same post (retry) — but a new variant for
    // a different platform to test the join.
    const second = await seedAttempt({
      companyId: COMPANY_A,
      startedAt: later,
      status: "succeeded",
      platform: "x",
      postMasterId: first.postId,
    });

    const result = await listPublishAttempts({
      postMasterId: first.postId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.attempts.length).toBe(2);
    expect(result.data.attempts[0]?.id).toBe(second.attemptId);
    expect(result.data.attempts[0]?.platform).toBe("x");
    expect(result.data.attempts[0]?.status).toBe("succeeded");
    expect(result.data.attempts[1]?.id).toBe(first.attemptId);
    expect(result.data.attempts[1]?.platform).toBe("linkedin_personal");
    expect(result.data.attempts[1]?.status).toBe("failed");
  });

  it("filters attempts under another company's job", async () => {
    const a = await seedAttempt({
      companyId: COMPANY_A,
      startedAt: "2026-04-01T10:00:00Z",
    });
    const b = await seedAttempt({
      companyId: COMPANY_B,
      startedAt: "2026-04-02T10:00:00Z",
    });

    const result = await listPublishAttempts({
      postMasterId: a.postId,
      companyId: COMPANY_A,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.attempts.length).toBe(1);
    expect(result.data.attempts[0]?.id).toBe(a.attemptId);

    // Same call from B's perspective on B's own post id.
    const resultB = await listPublishAttempts({
      postMasterId: b.postId,
      companyId: COMPANY_B,
    });
    expect(resultB.ok).toBe(true);
    if (!resultB.ok) return;
    expect(resultB.data.attempts.length).toBe(1);
    expect(resultB.data.attempts[0]?.id).toBe(b.attemptId);
  });
});
