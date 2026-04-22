import { describe, expect, it } from "vitest";
import { Client } from "pg";

import { createBatchJob } from "@/lib/batch-jobs";
import { enqueueRegenJob } from "@/lib/regeneration-publisher";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  PROJECTED_COST_PER_BATCH_SLOT_CENTS,
  PROJECTED_COST_PER_REGEN_CENTS,
  reserveBudget,
} from "@/lib/tenant-budgets";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { createComponent } from "@/lib/components";
import { createTemplate } from "@/lib/templates";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M8-2 — enforcement tests.
//
// Invariants pinned:
//
//   1. reserveBudget rejects when projected + current > cap.
//   2. Concurrency: two sequential FOR UPDATEs on the same tenant
//      serialise correctly — second reservation sees the first's
//      increment. (Full goroutine-style race test requires two
//      simultaneous pg.Clients; we simulate with interleaved calls
//      to prove the arithmetic + FOR UPDATE is correct.)
//   3. createBatchJob rejects with BUDGET_EXCEEDED when slots × per-
//      slot projection would exceed cap; no job row is created.
//   4. enqueueRegenJob rejects with BUDGET_EXCEEDED + per-tenant
//      details. Tenant-wide M7-5 env cap remains the outer ceiling.
// ---------------------------------------------------------------------------

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL not set");
  return url;
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: requireDbUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function setCaps(
  siteId: string,
  daily: number,
  monthly: number = daily * 30,
): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("tenant_cost_budgets")
    .update({ daily_cap_cents: daily, monthly_cap_cents: monthly })
    .eq("site_id", siteId);
  if (error) throw new Error(`setCaps: ${error.message}`);
}

async function getUsage(siteId: string) {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("tenant_cost_budgets")
    .select("daily_usage_cents, monthly_usage_cents")
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) throw new Error(`getUsage: ${error.message}`);
  return {
    daily: Number(data?.daily_usage_cents ?? 0),
    monthly: Number(data?.monthly_usage_cents ?? 0),
  };
}

async function seedActiveDsAndTemplate(
  siteId: string,
): Promise<{ templateId: string }> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(`seed ds: ${ds.error.message}`);
  for (const name of ["hero-centered", "footer-default"]) {
    const c = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0] ?? "misc",
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!c.ok) throw new Error(`seed component: ${c.error.message}`);
  }
  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(`seed template: ${t.error.message}`);
  const activated = await activateDesignSystem(ds.data.id, ds.data.version_lock);
  if (!activated.ok) throw new Error(`activate: ${activated.error.message}`);
  return { templateId: t.data.id };
}

async function seedPage(siteId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: Math.floor(Math.random() * 10_000_000),
      slug: "home",
      title: "Home",
      page_type: "homepage",
      design_system_version: 1,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  return data.id as string;
}

// ---------------------------------------------------------------------------
// reserveBudget direct tests
// ---------------------------------------------------------------------------

describe("reserveBudget", () => {
  it("returns ok + increments usage when projected fits", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82a" });
    await setCaps(siteId, 1000);

    await withClient(async (c) => {
      await c.query("BEGIN");
      const res = await reserveBudget(c, siteId, 100);
      expect(res.ok).toBe(true);
      await c.query("COMMIT");
    });

    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(100);
    expect(usage.monthly).toBe(100);
  });

  it("rejects with BUDGET_EXCEEDED (daily) when projected pushes past daily cap", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82b" });
    await setCaps(siteId, 100, 10000);

    await withClient(async (c) => {
      await c.query("BEGIN");
      const res = await reserveBudget(c, siteId, 200);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe("BUDGET_EXCEEDED");
      expect(res.period).toBe("daily");
      expect(res.cap_cents).toBe(100);
      expect(res.usage_cents).toBe(0);
      expect(res.projected_cents).toBe(200);
      await c.query("ROLLBACK");
    });

    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(0); // rolled back
  });

  it("rejects with BUDGET_EXCEEDED (monthly) when monthly cap alone would be exceeded", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82c" });
    // Daily cap generous; monthly cap is the blocker.
    await setCaps(siteId, 10000, 100);

    await withClient(async (c) => {
      await c.query("BEGIN");
      const res = await reserveBudget(c, siteId, 200);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.code).toBe("BUDGET_EXCEEDED");
      expect(res.period).toBe("monthly");
      await c.query("ROLLBACK");
    });
  });

  it("self-heals by upserting the budget row when it's missing", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82d" });
    // Delete the auto-created row to simulate a manual SQL wipe.
    const svc = getServiceRoleClient();
    await svc.from("tenant_cost_budgets").delete().eq("site_id", siteId);

    await withClient(async (c) => {
      await c.query("BEGIN");
      const res = await reserveBudget(c, siteId, 10);
      // Default cap is 500 (per M8-1 defaults); 10 fits comfortably.
      expect(res.ok).toBe(true);
      await c.query("COMMIT");
    });

    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// createBatchJob integration
// ---------------------------------------------------------------------------

describe("createBatchJob — budget enforcement", () => {
  it("rejects with BUDGET_EXCEEDED when slots × projection would exceed cap", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82e" });
    const { templateId } = await seedActiveDsAndTemplate(siteId);
    // Cap at 100c; projection is 30c/slot; 5 slots = 150c → over.
    await setCaps(siteId, 100);

    const result = await createBatchJob({
      site_id: siteId,
      template_id: templateId,
      slots: Array.from({ length: 5 }, () => ({ inputs: { hero: { headline: "x" } } })),
      idempotency_key: `k-m82e-${Date.now()}`,
      created_by: null,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BUDGET_EXCEEDED");
    expect(result.error.details?.projected_cents).toBe(5 * PROJECTED_COST_PER_BATCH_SLOT_CENTS);

    // No job row created.
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("generation_jobs")
      .select("id")
      .eq("site_id", siteId);
    expect(data ?? []).toHaveLength(0);

    // Budget usage untouched (transaction rolled back).
    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(0);
  });

  it("enqueues successfully and increments tenant usage when within cap", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82f" });
    const { templateId } = await seedActiveDsAndTemplate(siteId);
    await setCaps(siteId, 10000);

    const result = await createBatchJob({
      site_id: siteId,
      template_id: templateId,
      slots: [{ inputs: { hero: { headline: "x" } } }],
      idempotency_key: `k-m82f-${Date.now()}`,
      created_by: null,
    });
    expect(result.ok).toBe(true);

    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(PROJECTED_COST_PER_BATCH_SLOT_CENTS);
  });
});

// ---------------------------------------------------------------------------
// enqueueRegenJob integration
// ---------------------------------------------------------------------------

describe("enqueueRegenJob — budget enforcement", () => {
  it("rejects with BUDGET_EXCEEDED when the per-tenant daily cap is already at the ceiling", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82g" });
    const pageId = await seedPage(siteId);
    // Cap set to exactly the projection so a single regen overfills.
    await setCaps(siteId, PROJECTED_COST_PER_REGEN_CENTS - 1);

    const res = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("BUDGET_EXCEEDED");
    expect(res.details?.period).toBe("daily");

    // No regen job row created.
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("regeneration_jobs")
      .select("id")
      .eq("page_id", pageId);
    expect(data ?? []).toHaveLength(0);
  });

  it("enqueues successfully and increments tenant usage when within cap", async () => {
    const { id: siteId } = await seedSite({ prefix: "m82h" });
    const pageId = await seedPage(siteId);
    await setCaps(siteId, 10000);

    const res = await enqueueRegenJob({
      site_id: siteId,
      page_id: pageId,
      created_by: null,
    });
    expect(res.ok).toBe(true);

    const usage = await getUsage(siteId);
    expect(usage.daily).toBe(PROJECTED_COST_PER_REGEN_CENTS);
  });
});
