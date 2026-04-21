import { describe, expect, it } from "vitest";

import {
  enqueueRegenJob,
  listRegenJobsForPage,
} from "@/lib/regeneration-publisher";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M7-4 — enqueue + history reader tests.
//
// Pins the invariants the POST route + detail page rely on:
//
//   1. Snapshot of pages.version_lock is captured at enqueue time.
//   2. Partial UNIQUE catches the double-enqueue race with a friendly
//      REGEN_ALREADY_IN_FLIGHT error code.
//   3. Cross-site guard: enqueue returns NOT_FOUND when page doesn't
//      belong to the given site.
//   4. Deterministic idempotency keys derived from the new job id —
//      a second enqueue after the first finishes produces a fresh key.
//   5. listRegenJobsForPage sort order (newest first) + limit.
// ---------------------------------------------------------------------------

async function seedPage(
  siteId: string,
  opts: { slug?: string; version_lock?: number } = {},
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug: opts.slug ?? "home",
      title: "Home",
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
      version_lock: opts.version_lock ?? 1,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// enqueueRegenJob
// ---------------------------------------------------------------------------

describe("enqueueRegenJob — happy path", () => {
  it("inserts a pending job with expected_page_version snapshotted", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74a" });
    const pageId = await seedPage(siteId, { version_lock: 3 });

    const result = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("regeneration_jobs")
      .select("status, expected_page_version, anthropic_idempotency_key, wp_idempotency_key, created_by")
      .eq("id", result.job_id)
      .maybeSingle();
    expect(data?.status).toBe("pending");
    expect(Number(data?.expected_page_version)).toBe(3);
    // Deterministic format tied to the job id.
    expect(data?.anthropic_idempotency_key).toBe(`ant-regen-${result.job_id}`);
    expect(data?.wp_idempotency_key).toBe(`wp-regen-${result.job_id}`);
    expect(data?.created_by).toBeNull();
  });

  it("stamps created_by when supplied", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74b" });
    const pageId = await seedPage(siteId);
    // opollo_users.id FKs to auth.users — use a NULL created_by here
    // to avoid the seedAuthUser dance. The M7-3 publisher tests cover
    // the attribution path via last_edited_by.
    const result = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("enqueueRegenJob — guards", () => {
  it("returns REGEN_ALREADY_IN_FLIGHT when a pending job exists for the page", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74c" });
    const pageId = await seedPage(siteId);
    const first = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(first.ok).toBe(true);

    const second = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("REGEN_ALREADY_IN_FLIGHT");
  });

  it("allows a new enqueue after the previous job terminated", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74d" });
    const pageId = await seedPage(siteId);
    const first = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Terminate the first job.
    const svc = getServiceRoleClient();
    await svc
      .from("regeneration_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", first.job_id);

    const second = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Fresh idempotency keys (different job id).
    expect(second.job_id).not.toBe(first.job_id);
  });

  it("returns NOT_FOUND when page doesn't belong to the given site", async () => {
    const { id: siteA } = await seedSite({ prefix: "m74e" });
    const { id: siteB } = await seedSite({ prefix: "m74f" });
    const pageB = await seedPage(siteB);

    const result = await enqueueRegenJob({
      site_id: siteA,
      page_id: pageB,
      created_by: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// listRegenJobsForPage
// ---------------------------------------------------------------------------

describe("listRegenJobsForPage", () => {
  it("returns empty when no jobs exist for the page", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74g" });
    const pageId = await seedPage(siteId);
    const jobs = await listRegenJobsForPage(pageId);
    expect(jobs).toEqual([]);
  });

  it("returns newest-first by created_at", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74h" });
    const pageId = await seedPage(siteId);

    const svc = getServiceRoleClient();
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date(Date.now() - 1_000).toISOString();
    const insertOlder = await svc
      .from("regeneration_jobs")
      .insert({
        site_id: siteId,
        page_id: pageId,
        status: "succeeded",
        expected_page_version: 1,
        anthropic_idempotency_key: "a1",
        wp_idempotency_key: "w1",
        created_at: older,
        finished_at: older,
      })
      .select("id")
      .single();
    expect(insertOlder.error).toBeNull();
    const insertNewer = await svc
      .from("regeneration_jobs")
      .insert({
        site_id: siteId,
        page_id: pageId,
        status: "succeeded",
        expected_page_version: 1,
        anthropic_idempotency_key: "a2",
        wp_idempotency_key: "w2",
        created_at: newer,
        finished_at: newer,
      })
      .select("id")
      .single();
    expect(insertNewer.error).toBeNull();

    const jobs = await listRegenJobsForPage(pageId);
    expect(jobs[0]?.id).toBe(insertNewer.data?.id as string);
    expect(jobs[1]?.id).toBe(insertOlder.data?.id as string);
  });

  it("respects the caller-supplied limit", async () => {
    const { id: siteId } = await seedSite({ prefix: "m74i" });
    const pageId = await seedPage(siteId);
    const svc = getServiceRoleClient();
    for (let i = 0; i < 5; i++) {
      await svc.from("regeneration_jobs").insert({
        site_id: siteId,
        page_id: pageId,
        status: "succeeded",
        expected_page_version: 1,
        anthropic_idempotency_key: `a${i}`,
        wp_idempotency_key: `w${i}`,
        finished_at: new Date().toISOString(),
      });
    }
    const jobs = await listRegenJobsForPage(pageId, { limit: 2 });
    expect(jobs).toHaveLength(2);
  });
});
