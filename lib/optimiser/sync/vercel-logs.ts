import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Vercel logs sync — Phase 1.5 follow-up.
//
// Pulls the last 24 h of HTTP logs from Vercel's REST API, filters
// to status >= 500, attributes each request to an opt_landing_pages
// row by URL match, and upserts into opt_metrics_daily with
// source='server_errors'.
//
// Wired into the Vercel deployment logs API:
//   GET https://api.vercel.com/v3/projects/{projectId}/runtime-logs
// (or the equivalent integrations log-drain query). Default to the
// project ID + token in env; bail out gracefully when either is unset.
//
// Env vars (all required for the sync to run; sync is a no-op when any
// is missing — diagnostics surface flags this):
//   - VERCEL_API_TOKEN — Vercel access token with 'logs:read' scope
//   - VERCEL_PROJECT_ID — the deployed project's id (prj_…)
//   - VERCEL_TEAM_ID — optional; required for team-scoped projects
//
// Failure modes the sync tolerates:
//   - 401/403  → env misconfigured; logged + diagnostic surfaces
//   - 429      → rate limit; daily cadence keeps us well below limits
//   - 5xx      → transient Vercel side; cron re-runs the next day
//   - parse    → individual log lines that don't match are skipped
//
// The metrics row shape:
//   { errors_5xx: number, total_requests: number, sampled_window_hours: number }
// ---------------------------------------------------------------------------

const VERCEL_API_BASE = "https://api.vercel.com";
const SAMPLED_WINDOW_HOURS = 24;
const MAX_LOG_PAGES = 10; // hard cap so a runaway response doesn't burn a slot
const PAGE_SIZE = 1000;

export type VercelSyncResult =
  | {
      ok: true;
      pages_with_errors: number;
      total_5xx: number;
      total_requests: number;
      rows_written: number;
    }
  | {
      ok: false;
      reason:
        | "env_missing"
        | "auth_failed"
        | "rate_limited"
        | "transport_error"
        | "no_pages";
      message: string;
    };

interface VercelLogEntry {
  /** ISO timestamp from Vercel. */
  timestampInMs?: number;
  level?: string;
  type?: string;
  /** The HTTP request URL — Vercel's payload shapes vary; we look at
   *  proxy.url, request.url, and message-embedded URL fields. */
  proxy?: { url?: string; statusCode?: number; method?: string };
  request?: { url?: string };
  statusCode?: number;
  message?: string;
}

interface VercelLogsResponse {
  logs?: VercelLogEntry[];
  pagination?: { next?: string };
}

export async function syncVercelLogs(): Promise<VercelSyncResult> {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !projectId) {
    return {
      ok: false,
      reason: "env_missing",
      message:
        "VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set; server-error feed is dormant.",
    };
  }

  const supabase = getServiceRoleClient();

  // Pull all managed landing pages once; build URL → page_id index.
  const { data: pages } = await supabase
    .from("opt_landing_pages")
    .select("id, client_id, url")
    .eq("managed", true)
    .is("deleted_at", null);
  if (!pages || pages.length === 0) {
    return {
      ok: false,
      reason: "no_pages",
      message: "No managed landing pages — nothing to attribute logs to.",
    };
  }
  const pageIndex = buildPageIndex(
    pages as Array<{ id: string; client_id: string; url: string }>,
  );

  // Pull the last SAMPLED_WINDOW_HOURS of logs, paged.
  const sinceMs = Date.now() - SAMPLED_WINDOW_HOURS * 60 * 60 * 1000;
  const counts = new Map<
    string,
    { errors: number; total: number; client_id: string }
  >();
  let cursor: string | undefined = undefined;
  let pagesFetched = 0;
  while (pagesFetched < MAX_LOG_PAGES) {
    const url = new URL(
      `/v3/projects/${encodeURIComponent(projectId)}/runtime-logs`,
      VERCEL_API_BASE,
    );
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("since", String(sinceMs));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (teamId) url.searchParams.set("teamId", teamId);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "auth_failed",
        message: `Vercel logs ${res.status}; check VERCEL_API_TOKEN scope.`,
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        reason: "rate_limited",
        message: "Vercel logs API returned 429; back off until tomorrow.",
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: "transport_error",
        message: `Vercel logs ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as VercelLogsResponse;
    for (const entry of json.logs ?? []) {
      const reqUrl =
        entry.proxy?.url ?? entry.request?.url ?? extractUrlFromMessage(entry.message);
      const status =
        entry.proxy?.statusCode ?? entry.statusCode ?? extractStatusFromMessage(entry.message);
      if (!reqUrl || !status) continue;
      const matched = pageIndex.match(reqUrl);
      if (!matched) continue;
      const slot = counts.get(matched.id) ?? {
        errors: 0,
        total: 0,
        client_id: matched.client_id,
      };
      slot.total += 1;
      if (status >= 500 && status < 600) slot.errors += 1;
      counts.set(matched.id, slot);
    }
    cursor = json.pagination?.next;
    pagesFetched += 1;
    if (!cursor) break;
  }

  // UPSERT one row per landing page that saw at least one request.
  const today = new Date().toISOString().slice(0, 10);
  let rowsWritten = 0;
  let totalErrors = 0;
  let totalRequests = 0;
  for (const [landingPageId, slot] of counts) {
    totalErrors += slot.errors;
    totalRequests += slot.total;
    const { error } = await supabase.from("opt_metrics_daily").upsert(
      {
        client_id: slot.client_id,
        landing_page_id: landingPageId,
        metric_date: today,
        source: "server_errors",
        dimension_key: "",
        dimension_value: "",
        metrics: {
          errors_5xx: slot.errors,
          total_requests: slot.total,
          sampled_window_hours: SAMPLED_WINDOW_HOURS,
        },
        ingested_at: new Date().toISOString(),
      },
      {
        onConflict:
          "landing_page_id,metric_date,source,dimension_key,dimension_value",
      },
    );
    if (error) {
      logger.warn("optimiser.vercel_logs.upsert_failed", {
        landing_page_id: landingPageId,
        err: error.message,
      });
      continue;
    }
    rowsWritten += 1;
  }

  return {
    ok: true,
    pages_with_errors: Array.from(counts.values()).filter((s) => s.errors > 0)
      .length,
    total_5xx: totalErrors,
    total_requests: totalRequests,
    rows_written: rowsWritten,
  };
}

interface PageIndex {
  match(requestUrl: string): { id: string; client_id: string } | null;
}

function buildPageIndex(
  pages: Array<{ id: string; client_id: string; url: string }>,
): PageIndex {
  // Build origin+path → page lookup. Strip query/hash; lowercase host.
  // Multiple landing pages can share a host but must have unique paths.
  const byKey = new Map<string, { id: string; client_id: string }>();
  for (const p of pages) {
    const k = canonicalKey(p.url);
    if (!k) continue;
    byKey.set(k, { id: p.id, client_id: p.client_id });
  }
  return {
    match(requestUrl: string) {
      const k = canonicalKey(requestUrl);
      if (!k) return null;
      return byKey.get(k) ?? null;
    },
  };
}

function canonicalKey(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

function extractUrlFromMessage(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

function extractStatusFromMessage(message: string | undefined): number | null {
  if (!message) return null;
  const m = message.match(/\b(\d{3})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 100 && n < 600 ? n : null;
}
