import { describe, expect, it, vi, type MockedFunction } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import type { AnthropicCallFn, AnthropicResponse } from "@/lib/anthropic-call";
import { runPageDocumentGenerator } from "@/lib/page-document-generator";
import { createSiteBlueprint, updateSiteBlueprint } from "@/lib/site-blueprint";
import { upsertRoutesFromPlan, listActiveRoutes } from "@/lib/route-registry";
import { bulkInsertSharedContent } from "@/lib/shared-content";
import type { PageDocument } from "@/lib/types/page-document";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M16-5 — unit + integration tests for the page document generator.
//
// Happy path + parse-failure cases use mocked Anthropic calls.
// DB reads/writes hit the live local Supabase.
// ---------------------------------------------------------------------------

// ─── SEED HELPERS ────────────────────────────────────────────────────────────

async function seedPage(siteId: string, opts: { slug?: string; pageType?: string; ordinal?: number } = {}) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const svc = getServiceRoleClient();
  const slug = opts.slug ?? "/";
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id:               siteId,
      wp_page_id:            opts.ordinal ?? 1,
      slug,
      title:                 slug === "/" ? "Home" : slug.replace("/", ""),
      page_type:             opts.pageType ?? "homepage",
      design_system_version: 1,
      status:                "draft",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedPage failed: ${error?.message}`);
  return data as { id: string };
}

async function seedBlueprintAndRoutes(siteId: string) {
  const bp = await createSiteBlueprint({ site_id: siteId, brand_name: "Test Brand" });
  if (!bp.ok) throw new Error("seedBlueprintAndRoutes: create failed");

  // Upsert the route
  const routeResult = await upsertRoutesFromPlan(siteId, [
    { slug: "/", pageType: "homepage", label: "Home", priority: 1 },
  ]);
  if (!routeResult.ok) throw new Error("seedBlueprintAndRoutes: upsert routes failed");
  const routes = await listActiveRoutes(siteId);
  if (!routes.ok) throw new Error("seedBlueprintAndRoutes: list routes failed");

  const homeRoute = routes.data.find(r => r.slug === "/");
  if (!homeRoute) throw new Error("seedBlueprintAndRoutes: home route not found");

  return { blueprint: bp.data, homeRoute };
}

// ─── CANNED CALL HELPERS ────────────────────────────────────────────────────

function makeValidDocument(pageId: string, routeId: string): PageDocument {
  return {
    schemaVersion: 1,
    pageId,
    routeId,
    pageType:      "homepage",
    root:          { props: { title: "Home — Test Brand", description: "A great website." } },
    content:       [
      {
        type:  "Hero",
        props: {
          id:          "11111111-1111-1111-1111-111111111111",
          headline:    "Transform Your Business",
          subheadline: "We help companies grow.",
          variant:     "centered",
          ctaVariant:  "primary",
        },
      },
      {
        type:  "CTABanner",
        props: {
          id:       "22222222-2222-2222-2222-222222222222",
          heading:  "Ready to get started?",
          variant:  "full-width",
        },
      },
    ],
    refs: {
      "11111111-1111-1111-1111-111111111111": {},
      "22222222-2222-2222-2222-222222222222": {},
    },
  };
}

function makeCannedCall(text: string): AnthropicCallFn {
  return vi.fn().mockResolvedValue({
    id:          "msg_test",
    model:       "claude-haiku-4-5-20251001",
    content:     [{ type: "text" as const, text }],
    stop_reason: "end_turn",
    usage:       { input_tokens: 100, output_tokens: 200 },
  } satisfies AnthropicResponse);
}

// Builds a call fn that returns different values on successive calls.
function makeSequentialCalls(...texts: string[]): AnthropicCallFn {
  let i = 0;
  return vi.fn().mockImplementation(() =>
    Promise.resolve({
      id:          "msg_test",
      model:       "claude-haiku-4-5-20251001",
      content:     [{ type: "text" as const, text: texts[Math.min(i++, texts.length - 1)] }],
      stop_reason: "end_turn",
      usage:       { input_tokens: 100, output_tokens: 200 },
    } satisfies AnthropicResponse),
  );
}

// ─── PARSE-ONLY TESTS (no full DB setup needed) ───────────────────────────────

describe("runPageDocumentGenerator — PAGE_NOT_FOUND", () => {
  it("returns PAGE_NOT_FOUND for a non-existent page", async () => {
    const site   = await seedSite({ prefix: "pg01" });
    const callFn = makeCannedCall("{}");

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: "00000000-0000-0000-0000-000000000002", routeId: "00000000-0000-0000-0000-000000000003", pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PAGE_NOT_FOUND");
    expect(callFn).not.toHaveBeenCalled();
  });
});

describe("runPageDocumentGenerator — BLUEPRINT_NOT_FOUND", () => {
  it("returns BLUEPRINT_NOT_FOUND when site has no blueprint", async () => {
    const site   = await seedSite({ prefix: "pg02" });
    const page   = await seedPage(site.id);
    const callFn = makeCannedCall("{}");

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: "00000000-0000-0000-0000-000000000003", pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("BLUEPRINT_NOT_FOUND");
    expect(callFn).not.toHaveBeenCalled();
  });
});

// ─── INTEGRATION TESTS (hit live Supabase) ───────────────────────────────────

describe("runPageDocumentGenerator — happy path", () => {
  it("calls Haiku, stores PageDocument, sets html_is_stale=true", async () => {
    const site                  = await seedSite({ prefix: "pg03" });
    const { homeRoute }         = await seedBlueprintAndRoutes(site.id);
    const page                  = await seedPage(site.id, { slug: "/", pageType: "homepage" });
    const validDoc              = makeValidDocument(page.id, homeRoute.id);
    // gen call + empty critique = 2 total calls
    const callFn = makeSequentialCalls(
      JSON.stringify(validDoc), // gen attempt 1
      "[]",                     // critique → no issues
    );

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cached).toBe(false);
    expect(r.pageId).toBe(page.id);
    expect(r.document.schemaVersion).toBe(1);
    expect(r.document.content[0].type).toBe("Hero");

    // Haiku called twice: gen + critique
    expect(callFn).toHaveBeenCalledTimes(2);

    // html_is_stale was set in DB
    const { getServiceRoleClient } = await import("@/lib/supabase");
    const { data } = await getServiceRoleClient()
      .from("pages")
      .select("page_document, html_is_stale")
      .eq("id", page.id)
      .single();
    expect(data?.html_is_stale).toBe(true);
    expect(data?.page_document).not.toBeNull();
  });
});

describe("runPageDocumentGenerator — cached", () => {
  it("returns cached document without calling Haiku", async () => {
    const site          = await seedSite({ prefix: "pg04" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const validDoc      = makeValidDocument(page.id, homeRoute.id);
    const callFn        = makeCannedCall(JSON.stringify(validDoc));

    // First call — stores document
    const r1 = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );
    expect(r1.ok).toBe(true);

    // Reset mock call count
    (callFn as MockedFunction<AnthropicCallFn>).mockClear();

    // Second call — should be cached
    const r2 = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.cached).toBe(true);
    expect(callFn).not.toHaveBeenCalled();
  });
});

describe("runPageDocumentGenerator — markdown fences", () => {
  it("strips markdown fences from Haiku response", async () => {
    const site          = await seedSite({ prefix: "pg05" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const validDoc      = makeValidDocument(page.id, homeRoute.id);
    const fenced        = `\`\`\`json\n${JSON.stringify(validDoc)}\n\`\`\``;
    const callFn        = makeSequentialCalls(fenced, "[]");

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(true);
  });
});

describe("runPageDocumentGenerator — retry on parse failure", () => {
  it("retries on JSON parse error and succeeds on second attempt", async () => {
    const site          = await seedSite({ prefix: "pg06" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const validDoc      = makeValidDocument(page.id, homeRoute.id);
    // First call returns invalid JSON, second returns valid
    const callFn = makeSequentialCalls(
      "Sorry, I cannot help with that.",  // parse fails
      JSON.stringify(validDoc),           // gen retry 2 succeeds
      "[]",                               // critique
    );

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.document.schemaVersion).toBe(1);
    // 3 calls: gen-1 (fail), gen-2 (ok), critique
    expect(callFn).toHaveBeenCalledTimes(3);
  });

  it("returns PARSE_FAILED after 3 failed generation attempts", async () => {
    const site          = await seedSite({ prefix: "pg07" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const callFn        = makeCannedCall("not json at all");

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("PARSE_FAILED");
    // Exactly 3 generation attempts
    expect(callFn).toHaveBeenCalledTimes(3);
  });
});

describe("runPageDocumentGenerator — validation failure retry", () => {
  it("retries on validation failure (missing Hero) and succeeds on second attempt", async () => {
    const site          = await seedSite({ prefix: "pg08" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const validDoc      = makeValidDocument(page.id, homeRoute.id);

    // First response: first section is not Hero
    const badDoc = {
      ...validDoc,
      content: [
        { type: "Features", props: { id: "33333333-3333-3333-3333-333333333333", heading: "Our Features", variant: "grid-3", features: [] } },
      ],
    };

    const callFn = makeSequentialCalls(
      JSON.stringify(badDoc),     // gen-1 fails validation
      JSON.stringify(validDoc),   // gen-2 succeeds
      "[]",                       // critique
    );

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(true);
    expect(callFn).toHaveBeenCalledTimes(3);
  });
});

describe("runPageDocumentGenerator — critique + revise", () => {
  it("applies revise pass when critique returns issues", async () => {
    const site          = await seedSite({ prefix: "pg09" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const draftDoc      = makeValidDocument(page.id, homeRoute.id);
    const revisedDoc    = {
      ...draftDoc,
      content: [
        {
          type:  "Hero",
          props: {
            id:          "11111111-1111-1111-1111-111111111111",
            headline:    "Grow Your Revenue by 40% with Expert Strategy",
            subheadline: "We help B2B companies scale.",
            variant:     "centered",
            ctaVariant:  "primary",
          },
        },
        draftDoc.content[1],
      ],
    };

    const critiqueIssues = [
      { sectionId: "11111111-1111-1111-1111-111111111111", field: "headline", issue: "Too generic" },
    ];

    const callFn = makeSequentialCalls(
      JSON.stringify(draftDoc),         // gen
      JSON.stringify(critiqueIssues),   // critique → has issues
      JSON.stringify(revisedDoc),       // revise
    );

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The revised headline should be used
    const heroSection = r.document.content.find(s => s.type === "Hero");
    expect((heroSection?.props as Record<string, string>).headline).toBe("Grow Your Revenue by 40% with Expert Strategy");
    // 3 calls: gen + critique + revise
    expect(callFn).toHaveBeenCalledTimes(3);
  });

  it("falls back to draft when revise produces invalid JSON", async () => {
    const site          = await seedSite({ prefix: "pg10" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const draftDoc      = makeValidDocument(page.id, homeRoute.id);

    const critiqueIssues = [
      { sectionId: "11111111-1111-1111-1111-111111111111", field: "headline", issue: "Too generic" },
    ];

    const callFn = makeSequentialCalls(
      JSON.stringify(draftDoc),        // gen
      JSON.stringify(critiqueIssues),  // critique
      "not valid json",                // revise fails
    );

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    // Should still succeed using the draft document
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Draft headline preserved
    const heroSection = r.document.content.find(s => s.type === "Hero");
    expect((heroSection?.props as Record<string, string>).headline).toBe("Transform Your Business");
  });
});

describe("runPageDocumentGenerator — CLAUDE_ERROR", () => {
  it("returns CLAUDE_ERROR when Haiku API throws", async () => {
    const site          = await seedSite({ prefix: "pg11" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const callFn        = vi.fn().mockRejectedValue(new Error("Network timeout")) as AnthropicCallFn;

    const r = await runPageDocumentGenerator(
      { siteId: site.id, briefId: "00000000-0000-0000-0000-000000000001", pageId: page.id, routeId: homeRoute.id, pageOrdinal: 0 },
      callFn,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CLAUDE_ERROR");
    expect(r.error.message).toContain("Network timeout");
  });
});

describe("runPageDocumentGenerator — idempotency keys", () => {
  it("uses correct idempotency key per attempt", async () => {
    const site          = await seedSite({ prefix: "pg12" });
    const { homeRoute } = await seedBlueprintAndRoutes(site.id);
    const page          = await seedPage(site.id);
    const validDoc      = makeValidDocument(page.id, homeRoute.id);
    const briefId       = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb";
    const callFn        = makeSequentialCalls(JSON.stringify(validDoc), "[]");

    await runPageDocumentGenerator(
      { siteId: site.id, briefId, pageId: page.id, routeId: homeRoute.id, pageOrdinal: 3 },
      callFn,
    );

    const calls = (callFn as MockedFunction<AnthropicCallFn>).mock.calls;
    // First call: generation attempt 1
    expect(calls[0][0].idempotency_key).toBe(`m16-page-gen-${briefId}-3-gen-1`);
    // Second call: critique
    expect(calls[1][0].idempotency_key).toBe(`m16-page-gen-${briefId}-3-critique-1`);
  });
});
