import "server-only";

// ---------------------------------------------------------------------------
// lib/drift-detector.ts
//
// M16-8 — WP content drift detection.
//
// For each published page in a site (wp_status = 'published' or
// 'drift_detected'), fetches the raw content from WP, hashes it, and
// compares against route_registry.wp_content_hash.
//
// Mismatch → pages.wp_status = 'drift_detected'.
// Match    → pages.wp_status = 'published'  (clears prior drift flag).
//
// Never auto-overwrites WP content.  Operator reviews three choices:
//   Accept WP  — update our hash, keep WP content as canonical
//   Overwrite  — republish our version to WP
//   Compare    — view side-by-side diff
//
// Risk 10 from docs/plans/m16-parent.md.
// ---------------------------------------------------------------------------

import { computeContentHash } from "@/lib/gutenberg-format";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { WpConfig } from "@/lib/wordpress";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DriftCheckResult =
  | {
      ok:      true;
      siteId:  string;
      checked: number;
      drifted: number;
      cleared: number;
      errors:  number;
    }
  | {
      ok:     false;
      code:   string;
      message: string;
    };

type PublishedPageRow = {
  id:          string;
  slug:        string;
  wp_page_id:  number;
  wp_status:   string;
};

type RouteHashRow = {
  id:              string;
  slug:            string;
  wp_content_hash: string | null;
};

// ─── WP raw content fetch ────────────────────────────────────────────────────

function authHeader(cfg: WpConfig): string {
  return `Basic ${Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64")}`;
}

async function fetchWpPageRawContent(
  cfg: WpConfig,
  wp_page_id: number,
): Promise<{ ok: true; raw: string } | { ok: false; code: string; message: string }> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const url  = `${base}/wp-json/wp/v2/pages/${wp_page_id}?_fields=content&context=edit`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return { ok: false, code: "NETWORK_ERROR", message: String(err) };
  }

  if (res.status === 404) {
    return { ok: false, code: "WP_PAGE_NOT_FOUND", message: `WP page ${wp_page_id} not found` };
  }
  if (!res.ok) {
    return { ok: false, code: "WP_API_ERROR", message: `WP GET pages/${wp_page_id} returned ${res.status}` };
  }

  let body: { content?: { raw?: string; rendered?: string } };
  try {
    body = await res.json() as typeof body;
  } catch {
    return { ok: false, code: "PARSE_ERROR", message: "Failed to parse WP page response" };
  }

  const raw = body.content?.raw ?? body.content?.rendered ?? "";
  return { ok: true, raw };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Runs drift detection for one site.
 * Requires `cfg` — caller supplies site credentials.
 */
export async function runDriftDetector(
  siteId: string,
  cfg: WpConfig,
): Promise<DriftCheckResult> {
  const svc = getServiceRoleClient();

  // Load published pages that have a wp_page_id
  const { data: pages, error: pagesErr } = await svc
    .from("pages")
    .select("id, slug, wp_page_id, wp_status")
    .eq("site_id", siteId)
    .in("wp_status", ["published", "drift_detected"])
    .not("wp_page_id", "is", null);

  if (pagesErr) {
    return { ok: false, code: "DB_ERROR", message: pagesErr.message };
  }
  if (!pages || pages.length === 0) {
    return { ok: true, siteId, checked: 0, drifted: 0, cleared: 0, errors: 0 };
  }

  // Load route hashes (keyed by slug)
  const slugs = pages.map(p => p.slug as string);
  const { data: routes } = await svc
    .from("route_registry")
    .select("id, slug, wp_content_hash")
    .eq("site_id", siteId)
    .in("slug", slugs);

  const routeBySlug = new Map<string, RouteHashRow>(
    (routes ?? []).map(r => [r.slug as string, r as RouteHashRow]),
  );

  let checked = 0;
  let drifted = 0;
  let cleared = 0;
  let errors  = 0;

  for (const page of pages as PublishedPageRow[]) {
    const route = routeBySlug.get(page.slug);
    if (!route?.wp_content_hash) {
      // No stored hash — can't detect drift, skip
      continue;
    }

    checked++;

    const fetchResult = await fetchWpPageRawContent(cfg, page.wp_page_id);
    if (!fetchResult.ok) {
      logger.warn("drift-detector.fetch-failed", {
        siteId,
        pageId: page.id,
        wpPageId: page.wp_page_id,
        code: fetchResult.code,
        error: fetchResult.message,
      });
      errors++;
      continue;
    }

    const currentHash = await computeContentHash(fetchResult.raw);
    const isDrifted   = currentHash !== route.wp_content_hash;

    if (isDrifted && page.wp_status !== "drift_detected") {
      const { error } = await svc
        .from("pages")
        .update({ wp_status: "drift_detected" })
        .eq("id", page.id);
      if (!error) {
        drifted++;
        logger.info("drift-detector.drift-found", { siteId, pageId: page.id, slug: page.slug });
      } else {
        logger.error("drift-detector.status-update-failed", { siteId, pageId: page.id, error: error.message });
        errors++;
      }
    } else if (!isDrifted && page.wp_status === "drift_detected") {
      const { error } = await svc
        .from("pages")
        .update({ wp_status: "published" })
        .eq("id", page.id);
      if (!error) {
        cleared++;
        logger.info("drift-detector.drift-cleared", { siteId, pageId: page.id, slug: page.slug });
      } else {
        errors++;
      }
    }
  }

  logger.info("drift-detector.done", { siteId, checked, drifted, cleared, errors });
  return { ok: true, siteId, checked, drifted, cleared, errors };
}
