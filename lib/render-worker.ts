/**
 * lib/render-worker.ts
 *
 * M16-6 — batch render worker. Processes all pages with html_is_stale=true
 * for a site and writes the resulting HTML back to pages.generated_html.
 *
 * Triggered by:
 *   - POST /api/sites/[id]/render (manual admin trigger)
 *   - Cron job (future M16-9 addition)
 *
 * Flow per site:
 *   1. Fetch all stale pages for the site.
 *   2. Fetch blueprint, active routes, all shared_content once.
 *   3. For each page:
 *      a. Validate the page_document (pure TypeScript, free).
 *      b. Render to HTML.
 *      c. Update pages: generated_html, html_is_stale=false, validation_result.
 *
 * Idempotent: re-running on an already-rendered page (html_is_stale=false)
 * is a no-op (the WHERE clause filters those out).
 */

import { logger } from "@/lib/logger";
import { componentRegistry } from "@/lib/component-registry";
import { getSiteBlueprint } from "@/lib/site-blueprint";
import { listActiveRoutes } from "@/lib/route-registry";
import { listSharedContent } from "@/lib/shared-content";
import { validatePageDocument } from "@/lib/page-validator";
import { renderPageDocument } from "@/lib/page-renderer";
import { getServiceRoleClient } from "@/lib/supabase";
import type { PageDocument } from "@/lib/types/page-document";
import type { ResolverDeps } from "@/lib/ref-resolver";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type RenderWorkerInput = {
  siteId: string;
};

export type RenderWorkerResult =
  | {
      ok:       true;
      rendered: number;
      skipped:  number;
      errors:   number;
    }
  | {
      ok:    false;
      error: { code: string; message: string };
    };

type StalePageRow = {
  id:            string;
  site_id:       string;
  page_document: PageDocument;
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export async function runRenderWorker(
  input: RenderWorkerInput,
): Promise<RenderWorkerResult> {
  const { siteId } = input;
  const svc = getServiceRoleClient();

  // 1. Load shared context once (blueprint, routes, content)
  const [bpResult, routesResult, contentResult] = await Promise.all([
    getSiteBlueprint(siteId),
    listActiveRoutes(siteId),
    listSharedContent(siteId),
  ]);

  if (!bpResult.ok || !bpResult.data) {
    return { ok: false, error: { code: "BLUEPRINT_NOT_FOUND", message: `No blueprint for site ${siteId}.` } };
  }

  const deps: ResolverDeps = {
    sharedContent: contentResult.ok ? contentResult.data : [],
    routes:        routesResult.ok  ? routesResult.data  : [],
  };

  // 2. Fetch all stale pages for this site
  const { data: stalePages, error: fetchErr } = await svc
    .from("pages")
    .select("id, site_id, page_document")
    .eq("site_id", siteId)
    .eq("html_is_stale", true)
    .not("page_document", "is", null);

  if (fetchErr) {
    return { ok: false, error: { code: "FETCH_FAILED", message: fetchErr.message } };
  }

  if (!stalePages || stalePages.length === 0) {
    logger.info("render-worker.no-stale-pages", { siteId });
    return { ok: true, rendered: 0, skipped: 0, errors: 0 };
  }

  logger.info("render-worker.start", { siteId, count: stalePages.length });

  let rendered = 0;
  let skipped  = 0;
  let errors   = 0;

  // 3. Process each stale page
  for (const row of stalePages as StalePageRow[]) {
    const pageId = row.id;
    const doc    = row.page_document;

    // a. Validate
    const validationResult = validatePageDocument(doc, {
      componentRegistry,
      routes:        deps.routes.map(r => ({ id: r.id, status: r.status })),
      sharedContent: deps.sharedContent.map(c => ({ id: c.id, content_type: c.content_type })),
    });

    if (validationResult.errors.length > 0) {
      logger.warn("render-worker.validation-errors", {
        siteId,
        pageId,
        errors: validationResult.errors.map(e => e.code),
      });
      // Still render — validation errors are operator-visible but don't block HTML generation.
      // The operator can review and re-generate sections.
    }

    // b. Render
    const renderResult = renderPageDocument(doc, deps, "wordpress");

    if (renderResult.warnings.length > 0) {
      logger.warn("render-worker.render-warnings", { siteId, pageId, warnings: renderResult.warnings });
    }

    if (!renderResult.html.trim()) {
      logger.error("render-worker.empty-html", { siteId, pageId });
      errors++;
      continue;
    }

    // c. Write back to DB
    const { error: updateErr } = await svc
      .from("pages")
      .update({
        generated_html:   renderResult.html,
        html_is_stale:    false,
        validation_result: validationResult,
      })
      .eq("id", pageId)
      .eq("site_id", siteId);

    if (updateErr) {
      logger.error("render-worker.update-failed", { siteId, pageId, error: updateErr.message });
      errors++;
      continue;
    }

    if (validationResult.errors.length > 0) {
      skipped++;
    } else {
      rendered++;
    }
  }

  logger.info("render-worker.done", { siteId, rendered, skipped, errors });
  return { ok: true, rendered, skipped, errors };
}
