import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import { readCredential } from "../credentials";
import { CredentialAuthError } from "./runner";

// ---------------------------------------------------------------------------
// GA4 Data API sync (spec §4.3).
//
// Endpoint: POST https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport
// Auth: OAuth 2.0 refresh-token exchange OR service account JWT —
// payload.refresh_token (preferred) or payload.service_account_json.
// Phase 1 ships the refresh-token path; service account is a Phase 2
// fallback. property_id is per client.
//
// Daily cadence; we pull yesterday's data + today's so far. Metrics:
//   sessions, totalUsers, engagementRate, averageSessionDuration,
//   bounceRate, conversions
// Dimensions: pagePath, deviceCategory, date
//
// One row per (landing_page, date, dimension_key=device, dimension_value=device).
// Plus an "all" rollup row with dimension_key='' / dimension_value=''.
// ---------------------------------------------------------------------------

const GA4_API_BASE = "https://analyticsdata.googleapis.com/v1beta";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MIN_SYNC_INTERVAL_MS = 23 * 60 * 60 * 1000;

type Ga4CredentialPayload = {
  refresh_token?: string;
  property_id: string;
  service_account_json?: string;
};

function getOAuthEnv(): { client_id: string; client_secret: string } | null {
  // GA4 reuses the Google Ads OAuth client (single shared OAuth client across
  // both flows). The Cloud OAuth client must have both `adwords` and
  // `analytics.readonly` scopes authorised, with the GA4 callback URL added
  // under "Authorised redirect URIs".
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { client_id: clientId, client_secret: clientSecret };
}

async function exchangeRefreshToken(
  refreshToken: string,
  oauth: { client_id: string; client_secret: string },
): Promise<string> {
  const body = new URLSearchParams({
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 400 || res.status === 401) {
      throw new CredentialAuthError(
        "EXPIRED",
        `GA4 refresh-token exchange failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`GA4 OAuth: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "GA4 OAuth: response missing access_token",
    );
  }
  return json.access_token;
}

export async function syncGa4ForClient(
  clientId: string,
): Promise<{ rows_written: number; skipped?: boolean }> {
  const supabase = getServiceRoleClient();
  const { data: cred } = await supabase
    .from("opt_client_credentials")
    .select("last_synced_at")
    .eq("client_id", clientId)
    .eq("source", "ga4")
    .maybeSingle();
  if (
    cred?.last_synced_at &&
    Date.now() - new Date(cred.last_synced_at as string).getTime() <
      MIN_SYNC_INTERVAL_MS
  ) {
    return { rows_written: 0, skipped: true };
  }

  const oauth = getOAuthEnv();
  if (!oauth) {
    return { rows_written: 0, skipped: true };
  }

  const secret = await readCredential(clientId, "ga4");
  const payload = secret.payload as Partial<Ga4CredentialPayload>;
  if (!payload.property_id) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "GA4 credential missing property_id",
    );
  }
  if (!payload.refresh_token) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "GA4 credential missing refresh_token (Phase 1 only supports refresh-token auth)",
    );
  }

  const accessToken = await exchangeRefreshToken(payload.refresh_token, oauth);

  const reportUrl = `${GA4_API_BASE}/properties/${encodeURIComponent(payload.property_id)}:runReport`;
  const reportBody = {
    dateRanges: [
      { startDate: "2daysAgo", endDate: "today" },
    ],
    dimensions: [
      { name: "pagePath" },
      { name: "deviceCategory" },
      { name: "date" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "totalUsers" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
      { name: "bounceRate" },
      { name: "conversions" },
    ],
    keepEmptyRows: false,
  };

  const res = await fetch(reportUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(reportBody),
  });
  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    throw new CredentialAuthError(
      "EXPIRED",
      `GA4 runReport ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 runReport ${res.status}: ${text.slice(0, 200)}`);
  }

  type GaRow = {
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  };
  const json = (await res.json()) as { rows?: GaRow[] };

  const baseUrlForClient = await resolveClientBaseUrl(clientId);

  let rowsWritten = 0;
  for (const r of json.rows ?? []) {
    const dims = r.dimensionValues ?? [];
    const mvals = r.metricValues ?? [];
    const path = dims[0]?.value ?? "";
    const device = dims[1]?.value ?? "all";
    const dateStr = dims[2]?.value ?? "";
    if (!path || !dateStr) continue;
    const url = baseUrlForClient
      ? new URL(path, baseUrlForClient).toString()
      : path;

    const { data: page } = await supabase
      .from("opt_landing_pages")
      .select("id")
      .eq("client_id", clientId)
      .eq("url", url)
      .maybeSingle();
    if (!page) continue;

    const metrics = {
      sessions: numberOrZero(mvals[0]?.value),
      total_users: numberOrZero(mvals[1]?.value),
      engagement_rate: numberOrZero(mvals[2]?.value),
      avg_session_duration_s: numberOrZero(mvals[3]?.value),
      bounce_rate: numberOrZero(mvals[4]?.value),
      conversions: numberOrZero(mvals[5]?.value),
    };

    const isoDate = formatGaDate(dateStr);
    const { error } = await supabase.from("opt_metrics_daily").upsert(
      {
        client_id: clientId,
        landing_page_id: page.id,
        metric_date: isoDate,
        source: "ga4",
        dimension_key: "device",
        dimension_value: device,
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
  return { rows_written: rowsWritten };
}

async function resolveClientBaseUrl(clientId: string): Promise<string | null> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("opt_client_credentials")
    .select("external_account_label")
    .eq("client_id", clientId)
    .eq("source", "ga4")
    .maybeSingle();
  // Slice 3 onboarding stores the canonical site origin in
  // external_account_label. Pre-onboarding clients have NULL — caller
  // falls back to raw page paths.
  return (data?.external_account_label as string | null) ?? null;
}

function numberOrZero(s: string | undefined): number {
  if (s == null) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatGaDate(s: string): string {
  // GA4 returns YYYYMMDD as a string; convert to YYYY-MM-DD.
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}
