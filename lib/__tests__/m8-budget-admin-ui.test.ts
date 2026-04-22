import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  getTenantBudget,
  updateTenantBudget,
} from "@/lib/tenant-budgets";

import { seedSite } from "./_helpers";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M8-5 — admin budget read/update tests.
// ---------------------------------------------------------------------------

describe("getTenantBudget", () => {
  it("returns the budget row for an existing site", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85a" });
    const budget = await getTenantBudget(siteId);
    expect(budget).not.toBeNull();
    expect(budget?.site_id).toBe(siteId);
    expect(budget?.version_lock).toBe(1);
  });

  it("returns null when the budget row doesn't exist", async () => {
    const result = await getTenantBudget(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(result).toBeNull();
  });
});

describe("updateTenantBudget", () => {
  it("updates caps and bumps version_lock on the happy path", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85b" });
    const before = await getTenantBudget(siteId);
    if (!before) throw new Error("seeded budget missing");

    const res = await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 1234, monthly_cap_cents: 56789 },
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.budget.daily_cap_cents).toBe(1234);
    expect(res.budget.monthly_cap_cents).toBe(56789);
    expect(res.budget.version_lock).toBe(before.version_lock + 1);
  });

  it("returns VERSION_CONFLICT when expected_version is stale", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85c" });
    const before = await getTenantBudget(siteId);
    if (!before) throw new Error("seeded budget missing");

    // First edit succeeds, version becomes 2.
    await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 200 },
      null,
    );
    // Stale edit with version=1 fails.
    const res = await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 999 },
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VERSION_CONFLICT");
    expect(res.details?.current_version).toBe(before.version_lock + 1);
  });

  it("returns NOT_FOUND when the site has no budget row", async () => {
    const res = await updateTenantBudget(
      "00000000-0000-0000-0000-000000000000",
      1,
      { daily_cap_cents: 1 },
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_FOUND");
  });

  it("accepts a partial patch (daily only)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85d" });
    const before = await getTenantBudget(siteId);
    if (!before) throw new Error("seeded budget missing");

    const res = await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 42 },
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.budget.daily_cap_cents).toBe(42);
    // Monthly preserved from default.
    expect(res.budget.monthly_cap_cents).toBe(before.monthly_cap_cents);
  });

  it("accepts 0 caps (paused tenant)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85e" });
    const before = await getTenantBudget(siteId);
    if (!before) throw new Error("seeded budget missing");

    const res = await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 0, monthly_cap_cents: 0 },
      null,
    );
    expect(res.ok).toBe(true);
  });

  it("stamps updated_by when supplied", async () => {
    const { id: siteId } = await seedSite({ prefix: "m85f" });
    const before = await getTenantBudget(siteId);
    if (!before) throw new Error("seeded budget missing");

    const user = await seedAuthUser({ role: "admin" });
    const res = await updateTenantBudget(
      siteId,
      before.version_lock,
      { daily_cap_cents: 500 },
      user.id,
    );
    expect(res.ok).toBe(true);

    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("tenant_cost_budgets")
      .select("updated_by")
      .eq("site_id", siteId)
      .maybeSingle();
    expect(data?.updated_by).toBe(user.id);
  });
});
