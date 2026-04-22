import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M8-1 — tenant_cost_budgets schema constraint tests.
//
// Invariants the M8-2 enforcement layer depends on:
//
//   1. UNIQUE on site_id — one budget row per site.
//   2. Backfill trigger — every new site gets a budget row created
//      automatically so the enforcement helper always finds a row.
//   3. CHECK constraints reject negative caps and negative usage.
//   4. CASCADE on site delete — budget vanishes with the site.
//   5. Default reset timestamps point forward (next day / next month
//      UTC).
// ---------------------------------------------------------------------------

describe("tenant_cost_budgets — schema invariants", () => {
  it("auto-creates a budget row when a new site is inserted", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81a" });
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("tenant_cost_budgets")
      .select("site_id, daily_cap_cents, monthly_cap_cents, daily_usage_cents, monthly_usage_cents, version_lock")
      .eq("site_id", siteId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data?.daily_usage_cents)).toBe(0);
    expect(Number(data?.monthly_usage_cents)).toBe(0);
    expect(Number(data?.version_lock)).toBe(1);
    expect(Number(data?.daily_cap_cents)).toBeGreaterThan(0);
    expect(Number(data?.monthly_cap_cents)).toBeGreaterThan(0);
  });

  it("rejects a second budget row for the same site", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81b" });
    const svc = getServiceRoleClient();
    const res = await svc
      .from("tenant_cost_budgets")
      .insert({ site_id: siteId });
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("23505");
  });

  it("rejects negative caps", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81c" });
    const svc = getServiceRoleClient();
    const res = await svc
      .from("tenant_cost_budgets")
      .update({ daily_cap_cents: -1 })
      .eq("site_id", siteId);
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("23514");
  });

  it("rejects negative usage", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81d" });
    const svc = getServiceRoleClient();
    const res = await svc
      .from("tenant_cost_budgets")
      .update({ daily_usage_cents: -1 })
      .eq("site_id", siteId);
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("23514");
  });

  it("cascades delete when the site is removed", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81e" });
    const svc = getServiceRoleClient();
    await svc.from("sites").delete().eq("id", siteId);
    const lookup = await svc
      .from("tenant_cost_budgets")
      .select("id")
      .eq("site_id", siteId);
    expect(lookup.data).toEqual([]);
  });

  it("reset timestamps point forward on create", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81f" });
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("tenant_cost_budgets")
      .select("daily_reset_at, monthly_reset_at")
      .eq("site_id", siteId)
      .maybeSingle();
    expect(data?.daily_reset_at).toBeTruthy();
    expect(data?.monthly_reset_at).toBeTruthy();
    const now = Date.now();
    expect(new Date(data!.daily_reset_at).getTime()).toBeGreaterThan(now);
    expect(new Date(data!.monthly_reset_at).getTime()).toBeGreaterThan(now);
  });

  it("accepts 0 caps (paused tenant)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m81g" });
    const svc = getServiceRoleClient();
    const res = await svc
      .from("tenant_cost_budgets")
      .update({ daily_cap_cents: 0, monthly_cap_cents: 0 })
      .eq("site_id", siteId);
    expect(res.error).toBeNull();
  });
});
