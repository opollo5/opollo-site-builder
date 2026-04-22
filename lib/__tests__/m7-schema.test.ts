import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M7-1 — regeneration_jobs + regeneration_events schema constraint tests.
//
// Pins the write-safety invariants the worker relies on:
//
//   1. One active regen per page (partial UNIQUE on page_id WHERE
//      status IN ('pending', 'running')).
//   2. A terminal-state job doesn't block a new enqueue.
//   3. Lease-coherence CHECK — pending rows can't carry worker_id /
//      lease_expires_at.
//   4. CASCADE from sites + pages.
//   5. Events append-only via FK ON DELETE CASCADE from the job.
// ---------------------------------------------------------------------------

type SiteSeed = { name: string; prefix: string };

async function seedSite(opts: SiteSeed): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("sites")
    .insert({
      name: opts.name,
      prefix: opts.prefix,
      wp_url: `https://${opts.prefix}.example`,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedSite: ${error?.message ?? "no row"}`);
  return data.id as string;
}

async function seedPage(siteId: string, slug: string): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug,
      title: `Page for ${slug}`,
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return data.id as string;
}

async function insertRegenJob(opts: {
  siteId: string;
  pageId: string;
  status?: "pending" | "running" | "succeeded" | "failed" | "failed_gates" | "cancelled";
  worker_id?: string;
  lease_expires_at?: string;
}) {
  const svc = getServiceRoleClient();
  return svc
    .from("regeneration_jobs")
    .insert({
      site_id: opts.siteId,
      page_id: opts.pageId,
      status: opts.status ?? "pending",
      expected_page_version: 1,
      anthropic_idempotency_key: `anth-${opts.pageId}-${Math.random()}`,
      wp_idempotency_key: `wp-${opts.pageId}-${Math.random()}`,
      worker_id: opts.worker_id ?? null,
      lease_expires_at: opts.lease_expires_at ?? null,
    })
    .select("id")
    .single();
}

// ---------------------------------------------------------------------------
// Partial UNIQUE: one active regen per page
// ---------------------------------------------------------------------------

describe("regeneration_jobs — one active per page constraint", () => {
  it("rejects a second pending job for the same page", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71a" });
    const pageId = await seedPage(siteId, "home");

    const first = await insertRegenJob({ siteId, pageId });
    expect(first.error).toBeNull();

    const second = await insertRegenJob({ siteId, pageId });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("rejects a second running job for the same page", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71b" });
    const pageId = await seedPage(siteId, "home");

    const first = await insertRegenJob({
      siteId,
      pageId,
      status: "running",
      worker_id: "worker-a",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(first.error).toBeNull();

    const second = await insertRegenJob({ siteId, pageId });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("rejects a running + a pending simultaneously", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71c" });
    const pageId = await seedPage(siteId, "home");

    const first = await insertRegenJob({
      siteId,
      pageId,
      status: "running",
      worker_id: "worker-a",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(first.error).toBeNull();

    const second = await insertRegenJob({ siteId, pageId, status: "pending" });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("allows a new pending job after the previous one terminated", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71d" });
    const pageId = await seedPage(siteId, "home");

    const first = await insertRegenJob({ siteId, pageId });
    expect(first.error).toBeNull();

    // Transition the first to a terminal state.
    const svc = getServiceRoleClient();
    const terminate = await svc
      .from("regeneration_jobs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", first.data?.id as string);
    expect(terminate.error).toBeNull();

    const second = await insertRegenJob({ siteId, pageId });
    expect(second.error).toBeNull();
  });

  it("allows concurrent pending jobs across different pages on the same site", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71e" });
    const pageA = await seedPage(siteId, "page-a");
    const pageB = await seedPage(siteId, "page-b");

    const a = await insertRegenJob({ siteId, pageId: pageA });
    const b = await insertRegenJob({ siteId, pageId: pageB });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lease coherence
// ---------------------------------------------------------------------------

describe("regeneration_jobs — lease-coherence CHECK", () => {
  it("rejects pending status with a worker_id set", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71f" });
    const pageId = await seedPage(siteId, "home");

    const res = await insertRegenJob({
      siteId,
      pageId,
      status: "pending",
      worker_id: "worker-a",
    });
    expect(res.error).not.toBeNull();
    // Postgres CHECK violation.
    expect(res.error?.code).toBe("23514");
  });

  it("rejects pending status with a lease_expires_at set", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71g" });
    const pageId = await seedPage(siteId, "home");

    const res = await insertRegenJob({
      siteId,
      pageId,
      status: "pending",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("23514");
  });

  it("accepts running status with lease fields populated", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71h" });
    const pageId = await seedPage(siteId, "home");

    const res = await insertRegenJob({
      siteId,
      pageId,
      status: "running",
      worker_id: "worker-a",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(res.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CASCADE semantics
// ---------------------------------------------------------------------------

describe("regeneration_jobs — cascade behaviour", () => {
  it("cascades regen job deletion when the parent page is deleted", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71i" });
    const pageId = await seedPage(siteId, "home");
    const res = await insertRegenJob({ siteId, pageId });
    expect(res.error).toBeNull();
    const jobId = res.data?.id as string;

    const svc = getServiceRoleClient();
    const deletePage = await svc.from("pages").delete().eq("id", pageId);
    expect(deletePage.error).toBeNull();

    const lookup = await svc
      .from("regeneration_jobs")
      .select("id")
      .eq("id", jobId)
      .maybeSingle();
    expect(lookup.data).toBeNull();
  });

  it("cascades regen event deletion when the parent job is deleted", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71j" });
    const pageId = await seedPage(siteId, "home");
    const res = await insertRegenJob({ siteId, pageId });
    expect(res.error).toBeNull();
    const jobId = res.data?.id as string;

    const svc = getServiceRoleClient();
    const evInsert = await svc.from("regeneration_events").insert({
      regeneration_job_id: jobId,
      type: "worker_leased",
      payload: { worker_id: "w-a" },
    });
    expect(evInsert.error).toBeNull();

    const deleteJob = await svc
      .from("regeneration_jobs")
      .delete()
      .eq("id", jobId);
    expect(deleteJob.error).toBeNull();

    const lookup = await svc
      .from("regeneration_events")
      .select("id")
      .eq("regeneration_job_id", jobId);
    expect(lookup.data).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// status CHECK constraint
// ---------------------------------------------------------------------------

describe("regeneration_jobs — status CHECK", () => {
  it("rejects an unknown status value", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71k" });
    const pageId = await seedPage(siteId, "home");
    const svc = getServiceRoleClient();
    const res = await svc
      .from("regeneration_jobs")
      .insert({
        site_id: siteId,
        page_id: pageId,
        status: "weird",
        expected_page_version: 1,
        anthropic_idempotency_key: "k1",
        wp_idempotency_key: "k2",
      })
      .select("id")
      .maybeSingle();
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("23514");
  });

  it("accepts 'failed_gates' as a distinct terminal status", async () => {
    const siteId = await seedSite({ name: "S", prefix: "m71l" });
    const pageId = await seedPage(siteId, "home");

    const res = await insertRegenJob({
      siteId,
      pageId,
      status: "failed_gates",
    });
    expect(res.error).toBeNull();
  });
});
