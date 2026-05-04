import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));

import {
  approveSiteBlueprint,
  createSiteBlueprint,
  getSiteBlueprint,
  revertSiteBlueprintToDraft,
} from "@/lib/site-blueprint";
import {
  listActiveRoutes,
  upsertRoutesFromPlan,
} from "@/lib/route-registry";
import {
  bulkInsertSharedContent,
  listSharedContent,
  updateSharedContent,
  softDeleteSharedContent,
} from "@/lib/shared-content";
import { runSitePlanner } from "@/lib/site-planner";
import type { AnthropicCallFn, AnthropicResponse } from "@/lib/anthropic-call";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M16-7 — worker-ui integration tests.
//
// Covers:
//   1. Blueprint approve → revert round-trip
//   2. route_registry ordinal is persisted by upsertRoutesFromPlan
//   3. listActiveRoutes includes ordinal
//   4. shared_content CRUD (update label + soft-delete)
//   5. site-planner idempotency guard + blueprint gates
// ---------------------------------------------------------------------------

// ─── 1. Blueprint approve/revert ─────────────────────────────────────────────

describe("blueprint approve + revert", () => {
  it("draft → approved → draft round-trip", async () => {
    const site = await seedSite({ prefix: "m7a1" });
    const c = await createSiteBlueprint({ site_id: site.id, brand_name: "Round-trip Co" });
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error("create failed");

    const a = await approveSiteBlueprint(c.data.id, c.data.version_lock);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data.status).toBe("approved");
    const vAfterApprove = a.data.version_lock;

    const rv = await revertSiteBlueprintToDraft(a.data.id, vAfterApprove);
    expect(rv.ok).toBe(true);
    if (!rv.ok) return;
    expect(rv.data.status).toBe("draft");
    expect(rv.data.version_lock).toBe(vAfterApprove + 1);
  });

  it("approve with stale version_lock returns VERSION_CONFLICT", async () => {
    const site = await seedSite({ prefix: "m7a2" });
    const c = await createSiteBlueprint({ site_id: site.id });
    if (!c.ok) throw new Error("create failed");

    const r = await approveSiteBlueprint(c.data.id, 999);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VERSION_CONFLICT");
  });
});

// ─── 2+3. route_registry ordinal ─────────────────────────────────────────────

describe("route_registry ordinal column", () => {
  it("upsertRoutesFromPlan stores ordinal from priority", async () => {
    const site = await seedSite({ prefix: "m7b1" });
    const result = await upsertRoutesFromPlan(site.id, [
      { slug: "/",        page_type: "homepage", label: "Home",    priority: 1 },
      { slug: "/about",   page_type: "about",    label: "About",   priority: 2 },
      { slug: "/contact", page_type: "contact",  label: "Contact", priority: 3 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const home = result.data.find(r => r.slug === "/");
    const about = result.data.find(r => r.slug === "/about");
    expect(home?.ordinal).toBe(1);
    expect(about?.ordinal).toBe(2);
  });

  it("listActiveRoutes returns ordinal field", async () => {
    const site = await seedSite({ prefix: "m7b2" });
    await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home", priority: 5 },
    ]);
    const r = await listActiveRoutes(site.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const home = r.data.find(row => row.slug === "/");
    expect(home?.ordinal).toBe(5);
  });

  it("ordinal upserts correctly on repeated calls", async () => {
    const site = await seedSite({ prefix: "m7b3" });
    await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home", priority: 10 },
    ]);
    const r2 = await upsertRoutesFromPlan(site.id, [
      { slug: "/", page_type: "homepage", label: "Home v2", priority: 20 },
    ]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const home = r2.data.find(row => row.slug === "/");
    expect(home?.ordinal).toBe(20);
    expect(home?.label).toBe("Home v2");
  });
});

// ─── 4. shared_content CRUD ──────────────────────────────────────────────────

describe("shared_content update + soft-delete", () => {
  it("updates label and bumps version_lock", async () => {
    const site = await seedSite({ prefix: "m7c1" });
    const ins = await bulkInsertSharedContent(site.id, [
      { content_type: "testimonial", label: "First testimonial", content: { text: "Great!" } },
    ]);
    expect(ins.ok).toBe(true);
    if (!ins.ok) throw new Error("insert failed");
    const row = ins.data[0];

    const u = await updateSharedContent(
      row.id,
      { label: "Best testimonial", updated_by: null },
      row.version_lock,
    );
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.data.label).toBe("Best testimonial");
    expect(u.data.version_lock).toBe(row.version_lock + 1);
  });

  it("soft-delete removes item from listSharedContent", async () => {
    const site = await seedSite({ prefix: "m7c2" });
    const ins = await bulkInsertSharedContent(site.id, [
      { content_type: "faq", label: "Delete me", content: {} },
    ]);
    if (!ins.ok) throw new Error("insert failed");
    const row = ins.data[0];

    const del = await softDeleteSharedContent(row.id);
    expect(del.ok).toBe(true);

    const list = await listSharedContent(site.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.map(r => r.id)).not.toContain(row.id);
  });

  it("soft-delete returns NOT_FOUND for already-deleted item", async () => {
    const site = await seedSite({ prefix: "m7c3" });
    const ins = await bulkInsertSharedContent(site.id, [
      { content_type: "stat", label: "Double delete", content: {} },
    ]);
    if (!ins.ok) throw new Error("insert failed");
    const row = ins.data[0];

    await softDeleteSharedContent(row.id);
    const r2 = await softDeleteSharedContent(row.id);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe("NOT_FOUND");
  });
});

// ─── 5. site-planner — blueprint gates brief runner ──────────────────────────

describe("site-planner idempotency + blueprint gate", () => {
  function makePlan() {
    return JSON.stringify({
      routePlan: [
        { slug: "/",      pageType: "homepage", label: "Home",    priority: 1 },
        { slug: "/about", pageType: "about",    label: "About",   priority: 2 },
      ],
      navItems:     [{ label: "Home", routeSlug: "/", children: [] }],
      footerItems:  [],
      sharedContent: [
        { contentType: "testimonial", label: "Happy client", content: { text: "Loved it." } },
      ],
      ctaCatalogue: [{ id: "cta-1", text: "Get a quote", href: "/contact", style: "primary" }],
      seoDefaults:  { titleTemplate: "Page Title | TestCo" },
    });
  }

  function makeCallFn(): AnthropicCallFn {
    return vi.fn().mockResolvedValue({
      id:          "msg_test",
      model:       "claude-sonnet-4-6",
      content:     [{ type: "text" as const, text: makePlan() }],
      stop_reason: "end_turn",
      usage:       { input_tokens: 100, output_tokens: 200 },
    } satisfies AnthropicResponse);
  }

  it("creates blueprint + routes + shared content on first run", async () => {
    const site = await seedSite({ prefix: "m7d1" });
    const svc = (await import("@/lib/supabase")).getServiceRoleClient();
    const { data: brief } = await svc
      .from("briefs")
      .insert({
        site_id:               site.id,
        title:                 "M16-7 gate test brief",
        status:                "committed",
        source_storage_path:   "test/m7d1.txt",
        source_mime_type:      "text/plain",
        source_size_bytes:     100,
        source_sha256:         "m7d1sha",
        upload_idempotency_key: `idem-m7d1-${Date.now()}`,
        brand_voice:           null,
        design_direction:      null,
        parser_mode:           null,
        parser_warnings:       [],
        text_model:            "claude-sonnet-4-6",
        visual_model:          "claude-sonnet-4-6",
      })
      .select("id")
      .single();
    if (!brief) throw new Error("brief seed failed");

    const result = await runSitePlanner(
      { siteId: site.id, briefId: brief.id },
      makeCallFn(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.cached).toBe(false);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.sharedContent.length).toBeGreaterThan(0);

    const bp = await getSiteBlueprint(site.id);
    expect(bp.ok).toBe(true);
    if (!bp.ok) return;
    expect(bp.data?.status).toBe("draft");
  });

  it("returns cached=true on second call without a new Anthropic call", async () => {
    const site = await seedSite({ prefix: "m7d2" });
    const svc = (await import("@/lib/supabase")).getServiceRoleClient();
    const { data: brief } = await svc
      .from("briefs")
      .insert({
        site_id:               site.id,
        title:                 "M16-7 idempotency brief",
        status:                "committed",
        source_storage_path:   "test/m7d2.txt",
        source_mime_type:      "text/plain",
        source_size_bytes:     100,
        source_sha256:         "m7d2sha",
        upload_idempotency_key: `idem-m7d2-${Date.now()}`,
        brand_voice:           null,
        design_direction:      null,
        parser_mode:           null,
        parser_warnings:       [],
        text_model:            "claude-sonnet-4-6",
        visual_model:          "claude-sonnet-4-6",
      })
      .select("id")
      .single();
    if (!brief) throw new Error("brief seed failed");

    const call1 = makeCallFn();
    await runSitePlanner({ siteId: site.id, briefId: brief.id }, call1);

    const call2 = makeCallFn();
    const r2 = await runSitePlanner({ siteId: site.id, briefId: brief.id }, call2);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.cached).toBe(true);
    expect(vi.mocked(call2)).not.toHaveBeenCalled();
  });
});
