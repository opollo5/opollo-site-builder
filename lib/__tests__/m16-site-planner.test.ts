import { describe, expect, it, vi, type MockedFunction } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import type { AnthropicCallFn, AnthropicResponse } from "@/lib/anthropic-call";
import { runSitePlanner } from "@/lib/site-planner";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M16-4 — unit + integration tests for the site planner.
//
// "Happy path" + parse-failure cases use a mocked Anthropic call so no
// real credentials are required. The idempotency + store tests hit the
// live local Supabase (via seedSite) to verify the DB writes land correctly.
// ---------------------------------------------------------------------------

// Seed a brief row so the planner can look it up in DB
async function seedBrief(siteId: string, opts: { title?: string; brand_voice?: string } = {}) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("briefs")
    .insert({
      site_id:              siteId,
      title:                opts.title ?? "Test brief",
      status:               "committed",
      source_storage_path:  "test/path.txt",
      source_mime_type:     "text/plain",
      source_size_bytes:    100,
      source_sha256:        "abc123",
      upload_idempotency_key: `idem-${Date.now()}-${Math.random()}`,
      brand_voice:          opts.brand_voice ?? null,
      design_direction:     null,
      parser_mode:          null,
      parser_warnings:      [],
      text_model:           "claude-sonnet-4-6",
      visual_model:         "claude-sonnet-4-6",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedBrief failed: ${error?.message}`);
  return data as { id: string };
}

function makeSitePlan(overrides: Record<string, unknown> = {}): string {
  const plan = {
    routePlan: [
      { slug: "/", pageType: "homepage", label: "Home", priority: 1 },
      { slug: "/about", pageType: "about", label: "About", priority: 2 },
      { slug: "/contact", pageType: "contact", label: "Contact", priority: 3 },
    ],
    navItems: [
      { label: "Home", routeSlug: "/", children: [] },
      { label: "About", routeSlug: "/about", children: [] },
    ],
    footerItems: [
      { label: "Privacy Policy", routeSlug: null, externalUrl: "/privacy" },
    ],
    sharedContent: [
      {
        contentType: "cta",
        label: "Book a Call",
        content: { text: "Book a free consultation", url: "/contact", variant: "primary" },
      },
      {
        contentType: "testimonial",
        label: "Client quote",
        content: { quote: "Great service!", author: "Jane Doe", placeholder: true },
      },
    ],
    ctaCatalogue: [
      {
        label: "Book a Call",
        text: "Book a free consultation",
        targetRouteSlug: "/contact",
        externalUrl: null,
        variant: "primary",
      },
    ],
    seoDefaults: {
      titleTemplate: "%s | Test Brand",
      description:   "A great website.",
    },
    ...overrides,
  };
  return JSON.stringify(plan);
}

function makeCannedCall(responseText: string): AnthropicCallFn {
  return vi.fn().mockResolvedValue({
    id:          "msg_test",
    model:       "claude-sonnet-4-6",
    content:     [{ type: "text" as const, text: responseText }],
    stop_reason: "end_turn",
    usage:       { input_tokens: 100, output_tokens: 200 },
  } satisfies AnthropicResponse);
}

// ─── PARSE-ONLY TESTS (no DB needed) ─────────────────────────────────────────

describe("runSitePlanner — SITE_NOT_FOUND", () => {
  it("returns SITE_NOT_FOUND for a non-existent site", async () => {
    const callFn = makeCannedCall(makeSitePlan());
    const r = await runSitePlanner(
      { siteId: "00000000-0000-0000-0000-000000000001", briefId: "00000000-0000-0000-0000-000000000002" },
      callFn,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("SITE_NOT_FOUND");
    expect(callFn).not.toHaveBeenCalled();
  });
});

// ─── INTEGRATION TESTS (hit live Supabase) ────────────────────────────────────

describe("runSitePlanner — happy path", () => {
  it("calls Sonnet, stores blueprint + routes + shared content", async () => {
    const site   = await seedSite({ prefix: "sp01" });
    const brief  = await seedBrief(site.id, { title: "Digital marketing agency website" });
    const callFn = makeCannedCall(makeSitePlan());

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cached).toBe(false);

    // Blueprint stored
    expect(r.blueprint.site_id).toBe(site.id);
    expect(r.blueprint.status).toBe("draft");
    expect(Array.isArray(r.blueprint.route_plan)).toBe(true);
    expect((r.blueprint.route_plan as unknown[]).length).toBeGreaterThan(0);

    // Routes stored (one per routePlan item)
    expect(r.routes.length).toBe(3);
    expect(r.routes.map(rt => rt.slug)).toContain("/");
    expect(r.routes.map(rt => rt.slug)).toContain("/about");

    // Shared content stored
    expect(r.sharedContent.length).toBeGreaterThan(0);
    const ctaRow = r.sharedContent.find(c => c.content_type === "cta");
    expect(ctaRow).toBeDefined();
    expect(ctaRow?.label).toBe("Book a Call");

    // Anthropic called exactly once
    expect(callFn).toHaveBeenCalledTimes(1);
    const callArg = (callFn as MockedFunction<AnthropicCallFn>).mock.calls[0][0];
    expect(callArg.model).toBe("claude-sonnet-4-6");
    expect(callArg.idempotency_key).toBe(`m16-site-plan-${brief.id}`);
  });

  it("strips markdown fences from Sonnet response", async () => {
    const site   = await seedSite({ prefix: "sp02" });
    const brief  = await seedBrief(site.id);
    const fenced = `\`\`\`json\n${makeSitePlan()}\n\`\`\``;
    const callFn = makeCannedCall(fenced);

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.routes.length).toBeGreaterThan(0);
  });
});

describe("runSitePlanner — idempotency", () => {
  it("returns cached result on second call (no Anthropic call)", async () => {
    const site    = await seedSite({ prefix: "sp03" });
    const brief   = await seedBrief(site.id);
    const callFn  = makeCannedCall(makeSitePlan());

    // First call — stores the plan
    const r1 = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);
    expect(r1.ok).toBe(true);

    // Second call — should be cached
    const r2 = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.cached).toBe(true);

    // Anthropic called only once
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it("routes are idempotent on re-run (same slugs, no duplicates)", async () => {
    const site   = await seedSite({ prefix: "sp04" });
    const brief  = await seedBrief(site.id);
    const callFn = makeCannedCall(makeSitePlan());

    await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);
    const r2 = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // Routes should not be duplicated
    const slugs = r2.routes.map(rt => rt.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });
});

describe("runSitePlanner — PARSE_FAILED", () => {
  it("returns PARSE_FAILED when Sonnet returns non-JSON", async () => {
    const site   = await seedSite({ prefix: "sp05" });
    const brief  = await seedBrief(site.id);
    const callFn = makeCannedCall("Sorry, I cannot help with that.");

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PARSE_FAILED");
  });

  it("returns PARSE_FAILED when routePlan is missing", async () => {
    const site   = await seedSite({ prefix: "sp06" });
    const brief  = await seedBrief(site.id);
    const plan   = JSON.parse(makeSitePlan()) as Record<string, unknown>;
    delete plan.routePlan;
    const callFn = makeCannedCall(JSON.stringify(plan));

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PARSE_FAILED");
  });

  it("returns PARSE_FAILED when routePlan has no homepage slug", async () => {
    const site   = await seedSite({ prefix: "sp07" });
    const brief  = await seedBrief(site.id);
    const plan   = JSON.parse(makeSitePlan()) as Record<string, unknown>;
    (plan.routePlan as Array<Record<string, unknown>>)[0].slug = "/home";  // not "/"
    const callFn = makeCannedCall(JSON.stringify(plan));

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PARSE_FAILED");
  });
});

describe("runSitePlanner — CLAUDE_ERROR", () => {
  it("returns CLAUDE_ERROR when Anthropic API throws", async () => {
    const site   = await seedSite({ prefix: "sp08" });
    const brief  = await seedBrief(site.id);
    const callFn = vi.fn().mockRejectedValue(new Error("Network timeout")) as AnthropicCallFn;

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CLAUDE_ERROR");
    expect(r.error.message).toContain("Network timeout");
  });
});

describe("runSitePlanner — brand name extraction", () => {
  it("extracts brand name from titleTemplate", async () => {
    const site   = await seedSite({ prefix: "sp09" });
    const brief  = await seedBrief(site.id);
    const plan   = JSON.parse(makeSitePlan()) as Record<string, unknown>;
    (plan.seoDefaults as Record<string, unknown>).titleTemplate = "%s | Acme Digital";
    const callFn = makeCannedCall(JSON.stringify(plan));

    const r = await runSitePlanner({ siteId: site.id, briefId: brief.id }, callFn);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint.brand_name).toBe("Acme Digital");
  });
});

describe("runSitePlanner — BRIEF_NOT_FOUND", () => {
  it("returns BRIEF_NOT_FOUND for a non-existent brief", async () => {
    const site   = await seedSite({ prefix: "sp10" });
    const callFn = makeCannedCall(makeSitePlan());

    const r = await runSitePlanner(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000003" },
      callFn,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("BRIEF_NOT_FOUND");
    expect(callFn).not.toHaveBeenCalled();
  });
});
