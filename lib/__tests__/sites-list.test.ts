import { describe, expect, it } from "vitest";

import { listSites } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Regression pin for the M3 sign-off bug where /admin/sites showed only
// LeadSource even though four other active sites existed in the DB.
// listSites must return every non-removed row — no silent filter,
// no hidden limit, no default pagination that would miss rows.
// ---------------------------------------------------------------------------

describe("listSites", () => {
  it("returns every non-removed site regardless of created_at / prefix shape", async () => {
    // Seed five sites with distinct prefixes mimicking Steven's report
    // (digit-leading + letter-only). All default to status='active'
    // inside seedSite.
    const a = await seedSite({ name: "Alpha", prefix: "ls" });
    const b = await seedSite({ name: "Opollo testme", prefix: "lst" });
    const c = await seedSite({ name: "Testme", prefix: "1st" });
    const d = await seedSite({ name: "testme", prefix: "1st1" });
    const e = await seedSite({ name: "testme", prefix: "1234" });

    const res = await listSites();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = new Set(res.data.sites.map((s) => s.id));
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
    expect(ids.has(c.id)).toBe(true);
    expect(ids.has(d.id)).toBe(true);
    expect(ids.has(e.id)).toBe(true);
    expect(res.data.sites.length).toBe(5);
  });

  it("excludes removed sites", async () => {
    const alive = await seedSite({ name: "Alive", prefix: "al" });
    const dead = await seedSite({ name: "Dead", prefix: "de" });

    // Manually flip one to 'removed'; listSites must filter it out.
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("sites")
      .update({ status: "removed" })
      .eq("id", dead.id);
    expect(error).toBeNull();

    const res = await listSites();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = new Set(res.data.sites.map((s) => s.id));
    expect(ids.has(alive.id)).toBe(true);
    expect(ids.has(dead.id)).toBe(false);
  });
});
