import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import { claimDueDrafts } from "@/lib/social/publishing/claim-due-drafts";
import { requireDbConfig } from "@/lib/db-direct";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Concurrency — publish-due cron atomic claim (TOCTOU fix).
//
// Two concurrent cron ticks must never both claim the same draft. The
// prior implementation did a SELECT-then-UPDATE (PostgREST), allowing
// both ticks to read the same row before either wrote it back as
// 'publishing'. That double-billed bundle.social and emitted the same
// post twice.
//
// The new implementation wraps SELECT + UPDATE in a single SQL CTE with
// FOR UPDATE SKIP LOCKED. Concurrent ticks see disjoint row sets — the
// invariant this test pins.
//
// Pattern mirrors lib/__tests__/brief-runner-concurrency.test.ts. If a
// future migration drops the lock primitive, this test goes red.
// ---------------------------------------------------------------------------

const COMPANY_ID = "0a8a0aa0-0000-4000-8000-000000000001";
const N_DRAFTS = 6;

describe("publish-due — concurrent ticks claim disjoint draft sets (TOCTOU regression)", () => {
  let creator: SeededAuthUser;
  let draftIds: string[] = [];

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "publish-due-concurrency@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    await svc.from("platform_companies").upsert({
      id: COMPANY_ID,
      name: "Publish Due Conc Co",
      slug: "pub-due-conc",
      domain: "pub-due-conc.test",
      is_opollo_internal: false,
      timezone: "UTC",
      approval_default_rule: "any_one",
    });

    await svc.from("platform_users").upsert({
      id: creator.id,
      email: creator.email,
      full_name: "Publish Due Conc Creator",
      is_opollo_staff: false,
    });

    await svc
      .from("platform_company_users")
      .upsert({ company_id: COMPANY_ID, user_id: creator.id, role: "approver" });

    // Seed N drafts in state='scheduled' with past scheduled_at — all eligible
    // for claim. Use a fresh batch each test so we don't race other tests.
    const past = new Date(Date.now() - 60_000).toISOString();
    const rows = Array.from({ length: N_DRAFTS }, (_, i) => ({
      id: `0a8a0aa0-0000-4000-8000-1${i.toString().padStart(11, "0")}`,
      company_id: COMPANY_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: `concurrent-claim-${i}`,
      media_urls: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: past,
      publish_attempts: 0,
    }));
    draftIds = rows.map((r) => r.id);

    // Clean up any prior leftover rows from a previous run.
    await svc.from("social_post_drafts").delete().in("id", draftIds);

    const { error } = await svc.from("social_post_drafts").insert(rows);
    expect(error).toBeNull();
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (draftIds.length) {
      await svc.from("social_post_drafts").delete().in("id", draftIds);
    }
    await svc.from("platform_company_users").delete().eq("company_id", COMPANY_ID);
    await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  it("two concurrent claimDueDrafts calls return disjoint draft sets", async () => {
    const clientA = new Client(requireDbConfig());
    const clientB = new Client(requireDbConfig());
    await clientA.connect();
    await clientB.connect();

    try {
      // Fire both claims concurrently. Each runs the SELECT FOR UPDATE
      // SKIP LOCKED + UPDATE statement; whichever connection's lock
      // request hits the row first wins it; the other SKIPs it.
      const [claimedA, claimedB] = await Promise.all([
        claimDueDrafts(clientA, "test-worker-a", { maxAttempts: 3, batchSize: 10 }),
        claimDueDrafts(clientB, "test-worker-b", { maxAttempts: 3, batchSize: 10 }),
      ]);

      const idsA = new Set(claimedA.map((d) => d.id));
      const idsB = new Set(claimedB.map((d) => d.id));

      // Invariant: no row appears in both result sets.
      const overlap = [...idsA].filter((id) => idsB.has(id));
      expect(overlap).toEqual([]);

      // Union must equal the seeded set (BATCH_SIZE=10 > N_DRAFTS=6,
      // so between A and B every eligible draft gets claimed exactly once).
      const union = new Set<string>([...idsA, ...idsB]);
      const seeded = new Set(draftIds);
      const claimedFromOurSeed = [...union].filter((id) => seeded.has(id));
      expect(claimedFromOurSeed.length).toBe(N_DRAFTS);

      // Every claimed row should now be in state='publishing' with a
      // claim_at stamp from the appropriate worker.
      const svc = getServiceRoleClient();
      const { data: rowsAfter } = await svc
        .from("social_post_drafts")
        .select("id, state, publish_worker_id, publish_claimed_at")
        .in("id", draftIds);

      expect(rowsAfter?.every((r) => r.state === "publishing")).toBe(true);
      expect(
        rowsAfter?.every(
          (r) =>
            r.publish_worker_id === "test-worker-a" ||
            r.publish_worker_id === "test-worker-b",
        ),
      ).toBe(true);
      expect(rowsAfter?.every((r) => r.publish_claimed_at !== null)).toBe(true);
    } finally {
      await clientA.end();
      await clientB.end();
    }
  });

  it("claim filters: drafts at MAX_PUBLISH_ATTEMPTS are NOT re-claimed", async () => {
    const svc = getServiceRoleClient();

    // Bump 3 of the 6 drafts to publish_attempts=3 (= MAX).
    const exhaustedIds = draftIds.slice(0, 3);
    await svc
      .from("social_post_drafts")
      .update({ publish_attempts: 3 })
      .in("id", exhaustedIds);

    const client = new Client(requireDbConfig());
    await client.connect();
    try {
      const claimed = await claimDueDrafts(client, "test-worker-c", { maxAttempts: 3, batchSize: 10 });
      const claimedFromSeed = claimed
        .map((d) => d.id)
        .filter((id) => draftIds.includes(id));

      // Only the 3 non-exhausted drafts should be claimed.
      expect(claimedFromSeed.length).toBe(3);
      expect(claimedFromSeed.some((id) => exhaustedIds.includes(id))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("claim filters: archived drafts are NOT re-claimed", async () => {
    const svc = getServiceRoleClient();

    // Archive 2 of the 6 drafts.
    const archivedIds = draftIds.slice(0, 2);
    await svc
      .from("social_post_drafts")
      .update({ archived_at: new Date().toISOString() })
      .in("id", archivedIds);

    const client = new Client(requireDbConfig());
    await client.connect();
    try {
      const claimed = await claimDueDrafts(client, "test-worker-d", { maxAttempts: 3, batchSize: 10 });
      const claimedFromSeed = claimed
        .map((d) => d.id)
        .filter((id) => draftIds.includes(id));

      expect(claimedFromSeed.length).toBe(4);
      expect(claimedFromSeed.some((id) => archivedIds.includes(id))).toBe(false);
    } finally {
      await client.end();
    }
  });
});
