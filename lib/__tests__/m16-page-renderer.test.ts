import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { renderPageDocument } from "@/lib/page-renderer";
import { runRenderWorker } from "@/lib/render-worker";
import type { PageDocument } from "@/lib/types/page-document";
import type { ResolverDeps } from "@/lib/ref-resolver";
import { seedSite } from "./_helpers";
import { createSiteBlueprint } from "@/lib/site-blueprint";
import { upsertRoutesFromPlan, listActiveRoutes } from "@/lib/route-registry";

// ---------------------------------------------------------------------------
// M16-6 — tests for page-renderer (pure) and render-worker (DB).
// ---------------------------------------------------------------------------

function makeDoc(overrides: Partial<PageDocument> = {}): PageDocument {
  return {
    schemaVersion: 1,
    pageId:   "page-1",
    routeId:  "route-1",
    pageType: "homepage",
    root:  { props: { title: "Home", description: "Test page description." } },
    content: [
      {
        type:  "Hero",
        props: { id: "11111111-1111-1111-1111-111111111111", variant: "centered", headline: "Test Headline" },
      },
    ],
    refs: {},
    ...overrides,
  };
}

const EMPTY_DEPS: ResolverDeps = { sharedContent: [], routes: [] };

// ─── renderPageDocument (pure) ──────────────────────────────────────────────

describe("renderPageDocument — wordpress target", () => {
  it("returns section HTML fragments (no <html> wrapper)", () => {
    const { html, warnings } = renderPageDocument(makeDoc(), EMPTY_DEPS, "wordpress");
    expect(html).toContain("data-opollo-id");
    expect(html).not.toContain("<!DOCTYPE");
    expect(warnings).toHaveLength(0);
  });

  it("outputs opollo-Hero CSS class", () => {
    const { html } = renderPageDocument(makeDoc(), EMPTY_DEPS, "wordpress");
    expect(html).toContain("opollo-Hero");
  });

  it("escapes XSS in headline prop", () => {
    const doc = makeDoc({
      content: [
        { type: "Hero", props: { id: "11111111-1111-1111-1111-111111111111", variant: "centered", headline: '<script>alert(1)</script>' } },
      ],
    });
    const { html } = renderPageDocument(doc, EMPTY_DEPS, "wordpress");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderPageDocument — preview target", () => {
  it("wraps output in a full HTML shell with opollo-components.css link", () => {
    const { html } = renderPageDocument(makeDoc(), EMPTY_DEPS, "preview");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("opollo-components.css");
    expect(html).toContain("<title>Home</title>");
  });
});

describe("renderPageDocument — unknown component", () => {
  it("skips unknown component type and adds a warning", () => {
    const doc = makeDoc({
      content: [
        { type: "Hero",    props: { id: "11111111-1111-1111-1111-111111111111", variant: "centered", headline: "H" } },
        { type: "Unknown", props: { id: "22222222-2222-2222-2222-222222222222", variant: "x" } },
      ],
    });
    const { html, warnings } = renderPageDocument(doc, EMPTY_DEPS, "wordpress");
    expect(html).toContain("opollo-Hero");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Unknown");
  });
});

// ─── runRenderWorker (DB integration) ───────────────────────────────────────

describe("runRenderWorker — no stale pages", () => {
  it("returns rendered=0, skipped=0, errors=0 when no stale pages exist", async () => {
    const site = await seedSite({ prefix: "rw01" });
    await createSiteBlueprint({ site_id: site.id, brand_name: "Test" });
    await upsertRoutesFromPlan(site.id, [
      { slug: "/", pageType: "homepage", label: "Home", priority: 1 },
    ]);

    const r = await runRenderWorker({ siteId: site.id });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rendered).toBe(0);
    expect(r.skipped).toBe(0);
    expect(r.errors).toBe(0);
  });
});

describe("runRenderWorker — renders stale pages", () => {
  it("renders a stale page and sets html_is_stale=false", async () => {
    const site = await seedSite({ prefix: "rw02" });
    await createSiteBlueprint({ site_id: site.id, brand_name: "Test" });
    const routeResult = await upsertRoutesFromPlan(site.id, [
      { slug: "/", pageType: "homepage", label: "Home", priority: 1 },
    ]);
    expect(routeResult.ok).toBe(true);
    const routes = await listActiveRoutes(site.id);
    const homeRoute = routes.ok ? routes.data.find(r => r.slug === "/") : undefined;
    if (!homeRoute) throw new Error("No home route");

    const { getServiceRoleClient } = await import("@/lib/supabase");
    const svc = getServiceRoleClient();

    // Insert a page with a valid page_document and html_is_stale=true
    const doc = makeDoc({ pageId: "will-be-overwritten", routeId: homeRoute.id });
    const { data: page } = await svc
      .from("pages")
      .insert({
        site_id:               site.id,
        wp_page_id:            99,
        slug:                  "/",
        title:                 "Home",
        page_type:             "homepage",
        design_system_version: 1,
        status:                "draft",
        page_document:         doc,
        html_is_stale:         true,
      })
      .select("id")
      .single();
    if (!page) throw new Error("page insert failed");

    const r = await runRenderWorker({ siteId: site.id });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rendered + r.skipped).toBe(1);

    // Verify DB was updated
    const { data: updated } = await svc
      .from("pages")
      .select("generated_html, html_is_stale")
      .eq("id", page.id)
      .single();
    expect(updated?.html_is_stale).toBe(false);
    expect(typeof updated?.generated_html).toBe("string");
    expect((updated?.generated_html as string).length).toBeGreaterThan(0);
  });
});

describe("runRenderWorker — BLUEPRINT_NOT_FOUND", () => {
  it("returns BLUEPRINT_NOT_FOUND when site has no blueprint", async () => {
    const site = await seedSite({ prefix: "rw03" });
    const r = await runRenderWorker({ siteId: site.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("BLUEPRINT_NOT_FOUND");
  });
});
