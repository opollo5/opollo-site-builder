import { describe, expect, it } from "vitest";

import {
  createSiteBlueprint,
  getSiteBlueprint,
  updateSiteBlueprint,
  approveSiteBlueprint,
} from "@/lib/site-blueprint";
import {
  createRoute,
  listActiveRoutes,
  updateRoute,
  upsertRoutesFromPlan,
} from "@/lib/route-registry";
import {
  createSharedContent,
  listSharedContent,
  getSharedContentByIds,
  updateSharedContent,
  bulkInsertSharedContent,
  softDeleteSharedContent,
} from "@/lib/shared-content";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M16-2 data layer tests.
//
// Exercises the three new lib files that wrap the M16-1 tables.
// Follows lib/design-systems.ts conventions tested in m1-design-systems.test.ts.
//
// Tests hit the live local Supabase via `supabase start`.
// ---------------------------------------------------------------------------

// ─── site-blueprint ──────────────────────────────────────────────────────────

describe("site-blueprint — create + get", () => {
  it("creates a draft blueprint and returns it", async () => {
    const site = await seedSite({ prefix: "bp01" });
    const r = await createSiteBlueprint({ site_id: site.id, brand_name: "Acme Co" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("draft");
    expect(r.data.brand_name).toBe("Acme Co");
    expect(r.data.version_lock).toBe(1);
  });

  it("getSiteBlueprint returns the row by site_id", async () => {
    const site = await seedSite({ prefix: "bp02" });
    await createSiteBlueprint({ site_id: site.id, brand_name: "Brand B" });
    const r = await getSiteBlueprint(site.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data?.brand_name).toBe("Brand B");
  });

  it("getSiteBlueprint returns null data for a site with no blueprint", async () => {
    const site = await seedSite({ prefix: "bp03" });
    const r = await getSiteBlueprint(site.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it("rejects a second blueprint for the same site", async () => {
    const site = await seedSite({ prefix: "bp04" });
    await createSiteBlueprint({ site_id: site.id });
    const r2 = await createSiteBlueprint({ site_id: site.id });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe("UNIQUE_VIOLATION");
  });
});

describe("site-blueprint — update + version_lock", () => {
  it("updates brand_name and bumps version_lock", async () => {
    const site = await seedSite({ prefix: "bp05" });
    const c = await createSiteBlueprint({ site_id: site.id, brand_name: "Old Name" });
    if (!c.ok) throw new Error("create failed");

    const u = await updateSiteBlueprint(c.data.id, { brand_name: "New Name" }, 1);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.data.brand_name).toBe("New Name");
    expect(u.data.version_lock).toBe(2);
  });

  it("returns VERSION_CONFLICT when version_lock is stale", async () => {
    const site = await seedSite({ prefix: "bp06" });
    const c = await createSiteBlueprint({ site_id: site.id });
    if (!c.ok) throw new Error("create failed");

    const r = await updateSiteBlueprint(c.data.id, { brand_name: "Conflict" }, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VERSION_CONFLICT");
  });

  it("returns NOT_FOUND when id does not exist", async () => {
    const r = await updateSiteBlueprint("00000000-0000-0000-0000-000000000001", { brand_name: "x" }, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("site-blueprint — approve + revert", () => {
  it("transitions draft → approved", async () => {
    const site = await seedSite({ prefix: "bp07" });
    const c = await createSiteBlueprint({ site_id: site.id });
    if (!c.ok) throw new Error("create failed");

    const a = await approveSiteBlueprint(c.data.id, 1);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data.status).toBe("approved");
    expect(a.data.version_lock).toBe(2);
  });
});

// ─── route-registry ──────────────────────────────────────────────────────────

describe("route-registry — create + list", () => {
  it("creates a planned route", async () => {
    const site = await seedSite({ prefix: "rr01" });
    const r = await createRoute({ site_id: site.id, slug: "/home", page_type: "homepage", label: "Home" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.slug).toBe("/home");
    expect(r.data.status).toBe("planned");
  });

  it("listActiveRoutes excludes removed routes", async () => {
    const svc = (await import("@/lib/supabase")).getServiceRoleClient();
    const site = await seedSite({ prefix: "rr02" });
    const live = await createRoute({ site_id: site.id, slug: "/live", page_type: "service", label: "Live" });
    if (!live.ok) throw new Error("create live failed");
    const removed = await createRoute({ site_id: site.id, slug: "/gone", page_type: "about", label: "Gone" });
    if (!removed.ok) throw new Error("create removed failed");

    await svc.from("route_registry").update({ status: "removed" }).eq("id", removed.data.id);

    const r = await listActiveRoutes(site.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map(row => row.slug)).toContain("/live");
    expect(r.data.map(row => row.slug)).not.toContain("/gone");
  });
});

describe("route-registry — update + version_lock", () => {
  it("updates label and bumps version_lock", async () => {
    const site = await seedSite({ prefix: "rr03" });
    const c = await createRoute({ site_id: site.id, slug: "/svc", page_type: "service", label: "Service" });
    if (!c.ok) throw new Error("create failed");

    const u = await updateRoute(c.data.id, { label: "Our Services" }, 1);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.data.label).toBe("Our Services");
    expect(u.data.version_lock).toBe(2);
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const site = await seedSite({ prefix: "rr04" });
    const c = await createRoute({ site_id: site.id, slug: "/about", page_type: "about", label: "About" });
    if (!c.ok) throw new Error("create failed");

    const r = await updateRoute(c.data.id, { label: "About Us" }, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VERSION_CONFLICT");
  });
});

describe("route-registry — upsertRoutesFromPlan", () => {
  it("inserts multiple routes in one call", async () => {
    const site = await seedSite({ prefix: "rr05" });
    const r = await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home", priority: 1 },
      { slug: "/contact", page_type: "contact", label: "Contact", priority: 2 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(2);
    expect(r.data.map(row => row.slug).sort()).toEqual(["/", "/contact"]);
  });

  it("upserts on re-run (slug + site_id conflict updates, not errors)", async () => {
    const site = await seedSite({ prefix: "rr06" });
    await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home", priority: 1 },
    ]);
    const r2 = await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home Updated", priority: 1 },
    ]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // Updated label returned
    expect(r2.data[0].label).toBe("Home Updated");
  });
});

// ─── shared-content ──────────────────────────────────────────────────────────

describe("shared-content — create + list", () => {
  it("creates a CTA and returns it", async () => {
    const site = await seedSite({ prefix: "sc01" });
    const r = await createSharedContent({
      site_id: site.id,
      content_type: "cta",
      label: "Book a Call",
      content: { text: "Book your free call", variant: "primary" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.content_type).toBe("cta");
    expect(r.data.label).toBe("Book a Call");
  });

  it("listSharedContent filters by content_type", async () => {
    const site = await seedSite({ prefix: "sc02" });
    await createSharedContent({ site_id: site.id, content_type: "cta", label: "CTA 1" });
    await createSharedContent({ site_id: site.id, content_type: "testimonial", label: "Testimonial 1" });

    const r = await listSharedContent(site.id, { content_type: "cta" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.every(row => row.content_type === "cta")).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  it("listSharedContent excludes soft-deleted rows", async () => {
    const site = await seedSite({ prefix: "sc03" });
    const c = await createSharedContent({ site_id: site.id, content_type: "service", label: "Service A" });
    if (!c.ok) throw new Error("create failed");

    await softDeleteSharedContent(c.data.id);

    const r = await listSharedContent(site.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map(row => row.id)).not.toContain(c.data.id);
  });
});

describe("shared-content — getSharedContentByIds", () => {
  it("returns empty array for empty input", async () => {
    const r = await getSharedContentByIds([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(0);
  });

  it("fetches multiple items by ID in one call", async () => {
    const site = await seedSite({ prefix: "sc04" });
    const a = await createSharedContent({ site_id: site.id, content_type: "faq", label: "FAQ A" });
    const b = await createSharedContent({ site_id: site.id, content_type: "faq", label: "FAQ B" });
    if (!a.ok || !b.ok) throw new Error("create failed");

    const r = await getSharedContentByIds([a.data.id, b.data.id]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.map(row => row.id).sort()).toEqual([a.data.id, b.data.id].sort());
  });
});

describe("shared-content — update + version_lock", () => {
  it("updates content and bumps version_lock", async () => {
    const site = await seedSite({ prefix: "sc05" });
    const c = await createSharedContent({
      site_id: site.id, content_type: "testimonial", label: "T1",
      content: { quote: "Old quote", author: "Alice" },
    });
    if (!c.ok) throw new Error("create failed");

    const u = await updateSharedContent(c.data.id, { content: { quote: "New quote", author: "Alice" } }, 1);
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect((u.data.content as { quote: string }).quote).toBe("New quote");
    expect(u.data.version_lock).toBe(2);
  });

  it("returns VERSION_CONFLICT on stale lock", async () => {
    const site = await seedSite({ prefix: "sc06" });
    const c = await createSharedContent({ site_id: site.id, content_type: "stat", label: "Stat 1" });
    if (!c.ok) throw new Error("create failed");

    const r = await updateSharedContent(c.data.id, { label: "Updated" }, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VERSION_CONFLICT");
  });
});

describe("shared-content — bulkInsertSharedContent", () => {
  it("inserts multiple items in one call", async () => {
    const site = await seedSite({ prefix: "sc07" });
    const r = await bulkInsertSharedContent(site.id, [
      { content_type: "cta", label: "CTA 1", content: {} },
      { content_type: "cta", label: "CTA 2", content: {} },
      { content_type: "testimonial", label: "Testimonial 1", content: {} },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(3);
  });

  it("returns empty array for empty input", async () => {
    const r = await bulkInsertSharedContent("00000000-0000-0000-0000-000000000002", []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(0);
  });
});

describe("shared-content — softDeleteSharedContent", () => {
  it("marks row deleted without removing it", async () => {
    const site = await seedSite({ prefix: "sc08" });
    const c = await createSharedContent({ site_id: site.id, content_type: "offer", label: "Offer A" });
    if (!c.ok) throw new Error("create failed");

    const r = await softDeleteSharedContent(c.data.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.deleted).toBe(true);

    // Row still exists in DB — soft delete
    const svc = (await import("@/lib/supabase")).getServiceRoleClient();
    const { data } = await svc.from("shared_content").select("id, deleted_at").eq("id", c.data.id).single();
    expect(data!.deleted_at).not.toBeNull();
  });

  it("returns NOT_FOUND for already-deleted row", async () => {
    const site = await seedSite({ prefix: "sc09" });
    const c = await createSharedContent({ site_id: site.id, content_type: "cta", label: "CTA" });
    if (!c.ok) throw new Error("create failed");

    await softDeleteSharedContent(c.data.id);
    const r = await softDeleteSharedContent(c.data.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NOT_FOUND");
  });
});
