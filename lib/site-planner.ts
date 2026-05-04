/**
 * lib/site-planner.ts
 *
 * M16-4 — Pass 0+1 site planning. One Sonnet call per site.
 *
 * Generates a SitePlan JSON from the brief, stores it across three tables:
 *   - site_blueprints  (nav, footer, seoDefaults, ctaCatalogue, routePlan)
 *   - route_registry   (one row per route in the plan)
 *   - shared_content   (testimonials, services, faqs, stats, offers)
 *
 * Idempotency: if a blueprint with a non-empty route_plan already exists
 * for this site, returns the cached plan (no Sonnet call fired).
 * Routes are upserted (idempotent by site_id+slug).
 * Shared content is only inserted when none exists for this site yet.
 *
 * Anthropic idempotency key: `m16-site-plan-${briefId}` — replayed on
 * retries so Anthropic's 24h cache absorbs duplicate calls without billing.
 */

import type { AnthropicCallFn } from "@/lib/anthropic-call";
import { defaultAnthropicCall } from "@/lib/anthropic-call";
import { logger } from "@/lib/logger";
import { MODELS } from "@/lib/models";
import { SITE_PLANNER_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  createSiteBlueprint,
  getSiteBlueprint,
  updateSiteBlueprint,
  type SiteBlueprint,
} from "@/lib/site-blueprint";
import {
  upsertRoutesFromPlan,
  listActiveRoutes,
  type RouteRegistryRow,
} from "@/lib/route-registry";
import {
  bulkInsertSharedContent,
  listSharedContent,
  type SharedContentRow,
} from "@/lib/shared-content";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SitePlan, SharedContentType } from "@/lib/types/page-document";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type SitePlannerInput = {
  siteId:  string;
  briefId: string;
};

export type SitePlannerResult =
  | {
      ok:            true;
      blueprint:     SiteBlueprint;
      routes:        RouteRegistryRow[];
      sharedContent: SharedContentRow[];
      cached:        boolean;
    }
  | {
      ok:    false;
      error: { code: string; message: string };
    };

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

export async function runSitePlanner(
  input: SitePlannerInput,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<SitePlannerResult> {
  const { siteId, briefId } = input;

  // 1. Read site
  const svc = getServiceRoleClient();
  const { data: site, error: siteErr } = await svc
    .from("sites")
    .select("id, name, wp_url, brand_voice, design_direction")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr || !site) {
    return { ok: false, error: { code: "SITE_NOT_FOUND", message: `Site ${siteId} not found.` } };
  }

  // 2. Read brief + brief_pages for context
  const { data: brief, error: briefErr } = await svc
    .from("briefs")
    .select("id, title, brand_voice, design_direction")
    .eq("id", briefId)
    .maybeSingle();

  if (briefErr || !brief) {
    return { ok: false, error: { code: "BRIEF_NOT_FOUND", message: `Brief ${briefId} not found.` } };
  }

  const { data: briefPages } = await svc
    .from("brief_pages")
    .select("ordinal, title, source_text")
    .eq("brief_id", briefId)
    .order("ordinal", { ascending: true })
    .limit(10);

  // 3. Check idempotency — cached if blueprint already has a route_plan
  const existingBpResult = await getSiteBlueprint(siteId);
  if (existingBpResult.ok && existingBpResult.data) {
    const bp = existingBpResult.data;
    const hasRoutes = Array.isArray(bp.route_plan) && bp.route_plan.length > 0;
    if (hasRoutes) {
      logger.info("site-planner.cached", { siteId, briefId, blueprintId: bp.id });
      const [routesResult, contentResult] = await Promise.all([
        listActiveRoutes(siteId),
        listSharedContent(siteId),
      ]);
      return {
        ok:            true,
        cached:        true,
        blueprint:     bp,
        routes:        routesResult.ok ? routesResult.data : [],
        sharedContent: contentResult.ok ? contentResult.data : [],
      };
    }
  }

  // 4. Build user message for Sonnet
  const userMessage = buildUserMessage({
    siteName:         site.name as string,
    siteUrl:          site.wp_url as string,
    briefTitle:       brief.title as string,
    brandVoice:       (brief.brand_voice ?? site.brand_voice ?? null) as string | null,
    designDirection:  (brief.design_direction ?? site.design_direction ?? null) as string | null,
    pages:            (briefPages ?? []) as Array<{ ordinal: number; title: string; source_text: string }>,
  });

  // 5. Call Sonnet
  logger.info("site-planner.call.start", { siteId, briefId, model: MODELS.SITE_PLANNER });

  let rawText: string;
  try {
    const response = await callFn({
      model:           MODELS.SITE_PLANNER,
      max_tokens:      4096,
      system:          SITE_PLANNER_SYSTEM_PROMPT,
      messages:        [{ role: "user", content: userMessage }],
      idempotency_key: `m16-site-plan-${briefId}`,
    });
    const block = response.content.find(b => b.type === "text");
    rawText = block?.text ?? "";
  } catch (err) {
    logger.error("site-planner.call.error", { siteId, briefId, err });
    return {
      ok:    false,
      error: { code: "CLAUDE_ERROR", message: err instanceof Error ? err.message : String(err) },
    };
  }

  // 6. Parse + validate SitePlan
  const parseResult = parseSitePlan(rawText);
  if (!parseResult.ok) {
    logger.error("site-planner.parse.failed", { siteId, briefId, raw: rawText.slice(0, 500) });
    return parseResult;
  }
  const sitePlan = parseResult.data;

  logger.info("site-planner.call.ok", {
    siteId,
    briefId,
    routes:       sitePlan.routePlan.length,
    sharedItems:  sitePlan.sharedContent.length,
    ctas:         sitePlan.ctaCatalogue.length,
  });

  // 7. Get or create blueprint
  let blueprint: SiteBlueprint;
  const existingBp = existingBpResult.ok ? existingBpResult.data : null;

  if (!existingBp) {
    const created = await createSiteBlueprint({ site_id: siteId, brand_name: site.name as string });
    if (!created.ok) {
      logger.error("site-planner.blueprint.create.failed", { siteId, error: created.error });
      return { ok: false, error: { code: "STORE_FAILED", message: "Failed to create site blueprint." } };
    }
    blueprint = created.data;
  } else {
    blueprint = existingBp;
  }

  // 8. Update blueprint with plan data
  const brandName = extractBrandName(sitePlan.seoDefaults.titleTemplate, site.name as string);
  const updated = await updateSiteBlueprint(
    blueprint.id,
    {
      brand_name:    brandName,
      route_plan:    sitePlan.routePlan,
      nav_items:     sitePlan.navItems,
      footer_items:  sitePlan.footerItems,
      cta_catalogue: sitePlan.ctaCatalogue,
      seo_defaults:  sitePlan.seoDefaults as Record<string, unknown>,
    },
    blueprint.version_lock,
  );
  if (!updated.ok) {
    logger.error("site-planner.blueprint.update.failed", { blueprintId: blueprint.id, error: updated.error });
    return { ok: false, error: { code: "STORE_FAILED", message: "Failed to store plan to blueprint." } };
  }
  blueprint = updated.data;

  // 9. Upsert routes (idempotent — conflict on site_id+slug).
  // RoutePlanItem uses camelCase pageType; upsertRoutesFromPlan expects snake_case.
  const routeResult = await upsertRoutesFromPlan(
    siteId,
    sitePlan.routePlan.map(r => ({ ...r, page_type: r.pageType })),
  );
  if (!routeResult.ok) {
    logger.error("site-planner.routes.upsert.failed", { siteId, error: routeResult.error });
    return { ok: false, error: { code: "STORE_FAILED", message: "Failed to upsert routes." } };
  }

  // 10. Bulk insert shared content (only when site has none yet)
  const existingContentResult = await listSharedContent(siteId);
  const existingCount = existingContentResult.ok ? existingContentResult.data.length : 0;
  let sharedContent: SharedContentRow[] = existingContentResult.ok ? existingContentResult.data : [];

  if (existingCount === 0 && sitePlan.sharedContent.length > 0) {
    const insertItems = sitePlan.sharedContent.map(item => ({
      content_type: item.contentType as SharedContentType,
      label:        item.label,
      content:      item.content,
    }));
    const insertResult = await bulkInsertSharedContent(siteId, insertItems);
    if (!insertResult.ok) {
      logger.error("site-planner.content.insert.failed", { siteId, error: insertResult.error });
      return { ok: false, error: { code: "STORE_FAILED", message: "Failed to insert shared content." } };
    }
    sharedContent = insertResult.data;
  }

  return {
    ok:            true,
    cached:        false,
    blueprint,
    routes:        routeResult.data,
    sharedContent,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildUserMessage(opts: {
  siteName:        string;
  siteUrl:         string;
  briefTitle:      string;
  brandVoice:      string | null;
  designDirection: string | null;
  pages:           Array<{ ordinal: number; title: string; source_text: string }>;
}): string {
  const parts: string[] = [];

  parts.push("SITE INFORMATION");
  parts.push(`Brand name: ${opts.siteName}`);
  parts.push(`Website URL: ${opts.siteUrl}`);
  parts.push("");

  parts.push("BRIEF TITLE");
  parts.push(opts.briefTitle);
  parts.push("");

  if (opts.pages.length > 0) {
    parts.push("BRIEF PAGES");
    let charBudget = 2500;
    for (const p of opts.pages) {
      if (charBudget <= 0) break;
      const entry = `Page ${p.ordinal}: ${p.title}\n${p.source_text}`;
      const slice = entry.slice(0, charBudget);
      parts.push(slice);
      charBudget -= slice.length;
    }
    parts.push("");
  }

  if (opts.brandVoice) {
    parts.push("BRAND VOICE");
    parts.push(opts.brandVoice.slice(0, 500));
    parts.push("");
  }

  if (opts.designDirection) {
    parts.push("DESIGN DIRECTION");
    parts.push(opts.designDirection.slice(0, 300));
    parts.push("");
  }

  parts.push("Generate a complete SitePlan JSON for this website.");

  return parts.join("\n");
}

function parseSitePlan(
  raw: string,
): { ok: true; data: SitePlan } | { ok: false; error: { code: string; message: string } } {
  // Strip markdown fences
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok:    false,
      error: { code: "PARSE_FAILED", message: `Site planner response was not valid JSON. Got: ${text.slice(0, 200)}` },
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: { code: "PARSE_FAILED", message: "Site planner response was not a JSON object." } };
  }

  const obj = parsed as Record<string, unknown>;

  // Structural validation — all required top-level keys must be arrays/objects
  const required: Array<[string, string]> = [
    ["routePlan",    "array"],
    ["navItems",     "array"],
    ["footerItems",  "array"],
    ["sharedContent","array"],
    ["ctaCatalogue", "array"],
    ["seoDefaults",  "object"],
  ];

  for (const [key, expected] of required) {
    const val = obj[key];
    if (expected === "array" && !Array.isArray(val)) {
      return {
        ok:    false,
        error: { code: "PARSE_FAILED", message: `SitePlan missing or invalid "${key}" (expected array).` },
      };
    }
    if (expected === "object" && (typeof val !== "object" || val === null || Array.isArray(val))) {
      return {
        ok:    false,
        error: { code: "PARSE_FAILED", message: `SitePlan missing or invalid "${key}" (expected object).` },
      };
    }
  }

  // routePlan must have at least one item with slug "/"
  const routePlan = obj.routePlan as Array<Record<string, unknown>>;
  if (routePlan.length === 0) {
    return { ok: false, error: { code: "PARSE_FAILED", message: "SitePlan routePlan must not be empty." } };
  }
  if (!routePlan.some(r => r.slug === "/")) {
    return { ok: false, error: { code: "PARSE_FAILED", message: "SitePlan routePlan must include a homepage slug '/'." } };
  }

  return { ok: true, data: obj as unknown as SitePlan };
}

function extractBrandName(titleTemplate: string | undefined, fallback: string): string {
  if (!titleTemplate) return fallback;
  // "Page Title | Brand Name" → "Brand Name"
  const parts = titleTemplate.split("|");
  if (parts.length >= 2) {
    const brand = parts[parts.length - 1].trim().replace("%s", "").trim();
    if (brand) return brand;
  }
  return fallback;
}
