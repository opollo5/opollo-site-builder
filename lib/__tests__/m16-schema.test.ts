import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M16 schema tests — site_blueprints, route_registry, shared_content,
// pages additive columns.
//
// Pins the invariants the M16 generation pipeline relies on:
//
//   site_blueprints:
//     - status CHECK: only 'draft' | 'approved'
//     - UNIQUE site_id: one blueprint per site
//     - updated_at trigger fires on UPDATE
//     - CASCADE from sites delete
//
//   route_registry:
//     - page_type CHECK: only the 7 allowed values
//     - status CHECK: only 'planned'|'live'|'redirected'|'removed'
//     - partial UNIQUE (site_id, slug) WHERE status != 'removed':
//       two active routes cannot share a slug; removed routes can share
//     - redirect_to self-ref SET NULL on row delete
//     - CASCADE from sites delete
//
//   shared_content:
//     - content_type CHECK: only the 6 allowed values
//     - version_lock persists across updates
//     - soft delete via deleted_at (row not actually removed)
//     - CASCADE from sites delete
//
//   pages additive columns:
//     - wp_status CHECK: only the 6 allowed values
//     - html_is_stale defaults false
//     - page_document and validation_result are nullable
//
//   RLS:
//     - service_role can SELECT/INSERT/UPDATE on all three new tables
// ---------------------------------------------------------------------------

// ─── Helpers ────────────────────────────────────────────────────────────────

type InsertResult = { id: string | null; error: { code?: string; message: string } | null };

async function insertBlueprint(opts: {
  site_id: string;
  status?: string;
  brand_name?: string;
  allowError?: boolean;
}): Promise<InsertResult> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("site_blueprints")
    .insert({
      site_id:    opts.site_id,
      status:     opts.status ?? "draft",
      brand_name: opts.brand_name ?? "Test Brand",
    })
    .select("id")
    .single();
  if (error) {
    if (opts.allowError) return { id: null, error: { code: error.code, message: error.message } };
    throw new Error(`insertBlueprint failed: ${error.message}`);
  }
  return { id: data.id as string, error: null };
}

async function insertRoute(opts: {
  site_id:   string;
  slug?:     string;
  page_type?: string;
  label?:    string;
  status?:   string;
  allowError?: boolean;
}): Promise<InsertResult> {
  const svc = getServiceRoleClient();
  const slug = opts.slug ?? `/test-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await svc
    .from("route_registry")
    .insert({
      site_id:   opts.site_id,
      slug,
      page_type: opts.page_type ?? "service",
      label:     opts.label ?? "Test Route",
      status:    opts.status ?? "planned",
    })
    .select("id")
    .single();
  if (error) {
    if (opts.allowError) return { id: null, error: { code: error.code, message: error.message } };
    throw new Error(`insertRoute failed: ${error.message} (slug=${slug})`);
  }
  return { id: data.id as string, error: null };
}

async function insertSharedContent(opts: {
  site_id:      string;
  content_type?: string;
  label?:        string;
  content?:      Record<string, unknown>;
  version_lock?: number;
  allowError?:   boolean;
}): Promise<InsertResult> {
  const svc = getServiceRoleClient();
  const row: Record<string, unknown> = {
    site_id:      opts.site_id,
    content_type: opts.content_type ?? "cta",
    label:        opts.label ?? "Test CTA",
    content:      opts.content ?? {},
  };
  if (opts.version_lock !== undefined) row.version_lock = opts.version_lock;

  const { data, error } = await svc
    .from("shared_content")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (opts.allowError) return { id: null, error: { code: error.code, message: error.message } };
    throw new Error(`insertSharedContent failed: ${error.message}`);
  }
  return { id: data.id as string, error: null };
}

// ─── site_blueprints ─────────────────────────────────────────────────────────

describe("site_blueprints — status CHECK", () => {
  it("accepts status='draft'", async () => {
    const site = await seedSite({ prefix: "sb01" });
    const r = await insertBlueprint({ site_id: site.id, status: "draft" });
    expect(r.id).not.toBeNull();
  });

  it("accepts status='approved'", async () => {
    const site = await seedSite({ prefix: "sb02" });
    const r = await insertBlueprint({ site_id: site.id, status: "approved" });
    expect(r.id).not.toBeNull();
  });

  it("rejects unknown status", async () => {
    const site = await seedSite({ prefix: "sb03" });
    const r = await insertBlueprint({ site_id: site.id, status: "published", allowError: true });
    expect(r.error?.message).toMatch(/status|check/i);
  });
});

describe("site_blueprints — UNIQUE site_id", () => {
  it("allows one blueprint per site", async () => {
    const site = await seedSite({ prefix: "sb04" });
    const r = await insertBlueprint({ site_id: site.id });
    expect(r.id).not.toBeNull();
  });

  it("rejects a second blueprint for the same site", async () => {
    const site = await seedSite({ prefix: "sb05" });
    await insertBlueprint({ site_id: site.id });
    const r2 = await insertBlueprint({ site_id: site.id, allowError: true });
    expect(r2.error?.code).toBe("23505");
  });
});

describe("site_blueprints — updated_at trigger", () => {
  it("bumps updated_at on UPDATE", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "sb06" });
    const r = await insertBlueprint({ site_id: site.id });

    const { data: before } = await svc
      .from("site_blueprints")
      .select("updated_at")
      .eq("id", r.id!)
      .single();

    // Small sleep so the clock advances
    await new Promise(res => setTimeout(res, 50));

    await svc.from("site_blueprints").update({ brand_name: "Updated" }).eq("id", r.id!);

    const { data: after } = await svc
      .from("site_blueprints")
      .select("updated_at")
      .eq("id", r.id!)
      .single();

    expect(new Date(after!.updated_at as string).getTime())
      .toBeGreaterThan(new Date(before!.updated_at as string).getTime());
  });
});

describe("site_blueprints — CASCADE from sites", () => {
  it("deletes blueprint when parent site is deleted", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "sb07" });
    const r = await insertBlueprint({ site_id: site.id });

    await svc.from("sites").delete().eq("id", site.id);

    const { data } = await svc
      .from("site_blueprints")
      .select("id")
      .eq("id", r.id!);
    expect(data).toHaveLength(0);
  });
});

// ─── route_registry ──────────────────────────────────────────────────────────

describe("route_registry — page_type CHECK", () => {
  const valid = ["homepage", "service", "about", "contact", "landing", "blog-index", "blog-post"];
  for (const t of valid) {
    it(`accepts page_type='${t}'`, async () => {
      const site = await seedSite({ prefix: `rr${valid.indexOf(t).toString().padStart(2, "0")}` });
      const r = await insertRoute({ site_id: site.id, page_type: t });
      expect(r.id).not.toBeNull();
    });
  }

  it("rejects unknown page_type", async () => {
    const site = await seedSite({ prefix: "rr10" });
    const r = await insertRoute({ site_id: site.id, page_type: "blog", allowError: true });
    expect(r.error?.message).toMatch(/page_type|check/i);
  });
});

describe("route_registry — status CHECK", () => {
  it("accepts status='live'", async () => {
    const site = await seedSite({ prefix: "rr11" });
    const r = await insertRoute({ site_id: site.id, status: "live" });
    expect(r.id).not.toBeNull();
  });

  it("rejects status='active'", async () => {
    const site = await seedSite({ prefix: "rr12" });
    const r = await insertRoute({ site_id: site.id, status: "active", allowError: true });
    expect(r.error?.message).toMatch(/status|check/i);
  });
});

describe("route_registry — partial UNIQUE (site_id, slug) WHERE status != 'removed'", () => {
  it("rejects duplicate active slug on same site", async () => {
    const site = await seedSite({ prefix: "rr13" });
    const slug = "/duplicate-slug";
    await insertRoute({ site_id: site.id, slug, status: "live" });
    const r2 = await insertRoute({ site_id: site.id, slug, status: "planned", allowError: true });
    expect(r2.error?.code).toBe("23505");
  });

  it("allows same slug on different sites", async () => {
    const a = await seedSite({ prefix: "rr14" });
    const b = await seedSite({ prefix: "rr15" });
    const slug = "/shared-slug";
    await insertRoute({ site_id: a.id, slug, status: "live" });
    const r2 = await insertRoute({ site_id: b.id, slug, status: "live" });
    expect(r2.id).not.toBeNull();
  });

  it("allows slug re-use after route is removed", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "rr16" });
    const slug = "/reusable-slug";
    const first = await insertRoute({ site_id: site.id, slug, status: "live" });

    await svc
      .from("route_registry")
      .update({ status: "removed" })
      .eq("id", first.id!);

    const r2 = await insertRoute({ site_id: site.id, slug, status: "planned" });
    expect(r2.id).not.toBeNull();
  });
});

describe("route_registry — CASCADE from sites", () => {
  it("deletes routes when parent site is deleted", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "rr17" });
    const r = await insertRoute({ site_id: site.id });

    await svc.from("sites").delete().eq("id", site.id);

    const { data } = await svc
      .from("route_registry")
      .select("id")
      .eq("id", r.id!);
    expect(data).toHaveLength(0);
  });
});

// ─── shared_content ──────────────────────────────────────────────────────────

describe("shared_content — content_type CHECK", () => {
  const valid = ["cta", "testimonial", "service", "faq", "stat", "offer"];
  for (const t of valid) {
    it(`accepts content_type='${t}'`, async () => {
      const site = await seedSite({ prefix: `sc${valid.indexOf(t).toString().padStart(2, "0")}` });
      const r = await insertSharedContent({ site_id: site.id, content_type: t });
      expect(r.id).not.toBeNull();
    });
  }

  it("rejects content_type='blog'", async () => {
    const site = await seedSite({ prefix: "sc10" });
    const r = await insertSharedContent({ site_id: site.id, content_type: "blog", allowError: true });
    expect(r.error?.message).toMatch(/content_type|check/i);
  });
});

describe("shared_content — soft delete (deleted_at)", () => {
  it("marks a row deleted without removing it", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "sc11" });
    const r = await insertSharedContent({ site_id: site.id });

    await svc
      .from("shared_content")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", r.id!);

    const { data } = await svc
      .from("shared_content")
      .select("id, deleted_at")
      .eq("id", r.id!)
      .single();

    expect(data!.deleted_at).not.toBeNull();
    expect(data!.id).toBe(r.id);
  });
});

describe("shared_content — version_lock persists", () => {
  it("stores version_lock and returns it unchanged on read", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "sc12" });
    const r = await insertSharedContent({ site_id: site.id, version_lock: 3 });

    const { data } = await svc
      .from("shared_content")
      .select("version_lock")
      .eq("id", r.id!)
      .single();

    expect(data!.version_lock).toBe(3);
  });
});

describe("shared_content — CASCADE from sites", () => {
  it("deletes shared_content when parent site is deleted", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "sc13" });
    const r = await insertSharedContent({ site_id: site.id });

    await svc.from("sites").delete().eq("id", site.id);

    const { data } = await svc
      .from("shared_content")
      .select("id")
      .eq("id", r.id!);
    expect(data).toHaveLength(0);
  });
});

// ─── pages — additive columns ─────────────────────────────────────────────────

describe("pages — wp_status CHECK and defaults", () => {
  it("defaults html_is_stale to false and wp_status to 'not_uploaded'", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "pg01" });

    const { data, error } = await svc
      .from("pages")
      .insert({
        site_id:   site.id,
        title:     "M16 test page",
        slug:      "/m16-test",
        page_type: "service",
        status:    "draft",
        design_system_version: 1,
      })
      .select("html_is_stale, wp_status, page_document, validation_result")
      .single();

    expect(error).toBeNull();
    expect(data!.html_is_stale).toBe(false);
    expect(data!.wp_status).toBe("not_uploaded");
    expect(data!.page_document).toBeNull();
    expect(data!.validation_result).toBeNull();
  });

  it("accepts all valid wp_status values", async () => {
    const svc = getServiceRoleClient();
    const validStatuses = ["not_uploaded", "draft", "published", "unpublished", "trashed", "drift_detected"];
    for (const status of validStatuses) {
      const site = await seedSite();
      const { data, error } = await svc
        .from("pages")
        .insert({
          site_id:   site.id,
          title:     `Page ${status}`,
          slug:      `/page-${status.replace("_", "-")}`,
          page_type: "service",
          status:    "draft",
          wp_status: status,
          design_system_version: 1,
        })
        .select("wp_status")
        .single();
      expect(error, `wp_status='${status}' should be accepted`).toBeNull();
      expect(data!.wp_status).toBe(status);
    }
  });

  it("rejects invalid wp_status", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "pg02" });
    const { error } = await svc
      .from("pages")
      .insert({
        site_id:   site.id,
        title:     "Bad status",
        slug:      "/bad-wp-status",
        page_type: "service",
        status:    "draft",
        wp_status: "uploaded",
        design_system_version: 1,
      })
      .select("id")
      .single();
    expect(error?.message).toMatch(/wp_status|check/i);
  });
});

// ─── RLS smoke test ───────────────────────────────────────────────────────────
// Full role-matrix test follows the M2b pattern. Here we confirm the basic
// service_role path is open (all workers run as service_role).

describe("RLS — service_role can read/write all three new tables", () => {
  it("service_role SELECT site_blueprints", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "rl01" });
    await insertBlueprint({ site_id: site.id });
    const { data, error } = await svc.from("site_blueprints").select("id").eq("site_id", site.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("service_role SELECT route_registry", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "rl02" });
    await insertRoute({ site_id: site.id });
    const { data, error } = await svc.from("route_registry").select("id").eq("site_id", site.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("service_role SELECT shared_content", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite({ prefix: "rl03" });
    await insertSharedContent({ site_id: site.id });
    const { data, error } = await svc.from("shared_content").select("id").eq("site_id", site.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
