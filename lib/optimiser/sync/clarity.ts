import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { readCredential } from "../credentials";
import { CredentialAuthError } from "./runner";

// ---------------------------------------------------------------------------
// Microsoft Clarity sync (spec §4.2).
//
// Endpoint: GET https://www.clarity.ms/export-data/api/v1/project-live-insights
// Auth: Authorization: Bearer <api_token> per project. One token per
// client, stored in opt_client_credentials.payload.api_token.
//
// Clarity returns up to the last 1–3 days of aggregate metrics
// (sessions, scroll depth, dead clicks, rage clicks, quick backs) by
// URL + dimension. Daily cadence is fine; the endpoint is rate-limited
// to 10 requests per project per day so we stay well under that.
//
// Phase 1 sync writes one row per (landing_page, metric_date) into
// opt_metrics_daily with source = 'clarity'. UPSERT on the unique
// index makes rerun idempotent.
// ---------------------------------------------------------------------------

const CLARITY_API = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

const MIN_SYNC_INTERVAL_MS = 23 * 60 * 60 * 1000; // ≤ once per ~day

type ClarityCredentialPayload = { api_token: string };

type ClarityRow = {
  metricName?: string;
  information?: Array<Record<string, unknown>>;
};

export async function syncClarityForClient(
  clientId: string,
): Promise<{ rows_written: number; skipped?: boolean }> {
  const supabase = getServiceRoleClient();

  const { data: cred } = await supabase
    .from("opt_client_credentials")
    .select("last_synced_at")
    .eq("client_id", clientId)
    .eq("source", "clarity")
    .maybeSingle();
  if (
    cred?.last_synced_at &&
    Date.now() - new Date(cred.last_synced_at as string).getTime() <
      MIN_SYNC_INTERVAL_MS
  ) {
    return { rows_written: 0, skipped: true };
  }

  const secret = await readCredential(clientId, "clarity");
  const payload = secret.payload as Partial<ClarityCredentialPayload>;
  if (!payload.api_token) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "Clarity credential missing api_token",
    );
  }

  // numOfDays = 3 — Clarity caps at 1–3 day windows. 3-day pull lets
  // us recover if a tick is missed.
  const url = `${CLARITY_API}?numOfDays=3`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${payload.api_token}` },
  });
  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    throw new CredentialAuthError(
      "EXPIRED",
      `Clarity ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clarity ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as ClarityRow[];

  // Build a {url → daily metric} aggregation. Clarity returns one row
  // per metric with breakdowns inside `information`. We flatten into
  // one opt_metrics_daily row per (URL, date).
  const aggregated = aggregateByUrlAndDate(json);

  let rowsWritten = 0;
  for (const [url, byDate] of Object.entries(aggregated)) {
    const { data: page } = await supabase
      .from("opt_landing_pages")
      .select("id")
      .eq("client_id", clientId)
      .eq("url", url)
      .maybeSingle();
    if (!page) continue;
    for (const [date, metrics] of Object.entries(byDate)) {
      const { error } = await supabase.from("opt_metrics_daily").upsert(
        {
          client_id: clientId,
          landing_page_id: page.id,
          metric_date: date,
          source: "clarity",
          dimension_key: "",
          dimension_value: "",
          metrics,
          ingested_at: new Date().toISOString(),
        },
        {
          onConflict:
            "landing_page_id,metric_date,source,dimension_key,dimension_value",
        },
      );
      if (!error) rowsWritten += 1;
    }
  }
  if (rowsWritten === 0) {
    logger.info("optimiser.sync.clarity.no_matching_pages", {
      client_id: clientId,
    });
  }
  return { rows_written: rowsWritten };
}

function aggregateByUrlAndDate(
  rows: ClarityRow[],
): Record<string, Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const row of rows) {
    const metric = String(row.metricName ?? "unknown");
    for (const info of row.information ?? []) {
      const url = String(info.URL ?? info.url ?? "");
      if (!url) continue;
      const date = String(info.date ?? info.Date ?? new Date().toISOString().slice(0, 10));
      const value = info.totalSessionCount ?? info.sessions ?? info.sessionCount ?? info.value;
      if (typeof value !== "number") continue;
      out[url] = out[url] ?? {};
      out[url][date] = out[url][date] ?? {};
      out[url][date][metric] = value;
    }
  }
  return out;
}
