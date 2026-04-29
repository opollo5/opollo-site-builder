import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { readCredential } from "../credentials";
import { CredentialAuthError } from "./runner";

// ---------------------------------------------------------------------------
// Google Ads sync (spec §4.1).
//
// Phase 1 reads:
//   - campaign            → opt_campaigns
//   - ad_group            → opt_ad_groups
//   - ad_group_criterion  → opt_keywords
//   - ad_group_ad         → opt_ads
//   - landing_page_view   → opt_landing_pages (URL inventory) +
//                           opt_metrics_daily (daily metrics)
//
// Auth: the OAuth refresh token + customer id are read from
// opt_client_credentials.payload (JSON). The refresh token is exchanged
// for a fresh access token at the start of each sync; we never persist
// access tokens.
//
// Endpoint: googleads.googleapis.com/v17/customers/{customer_id}/googleAds:searchStream
// — GAQL query, paginated by token.
//
// All writes are idempotent UPSERTs keyed by (client_id, external_id)
// or (landing_page_id, metric_date, source, dimension). A rerun of the
// same day's data is a no-op.
// ---------------------------------------------------------------------------

const ADS_API_BASE = "https://googleads.googleapis.com/v17";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Module-level skip threshold: don't re-sync the same client twice in
// the same hour, even if cron tick happens. Source of truth is
// opt_client_credentials.last_synced_at.
const MIN_SYNC_INTERVAL_MS = 60 * 60 * 1000;

type AdsCredentialPayload = {
  refresh_token: string;
  customer_id: string;
  login_customer_id?: string;
};

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set.`);
  return v;
}

/** Returns NULL when the env vars haven't been provisioned yet — caller
 * must surface as a soft skip rather than an auth error. */
function getOAuthEnv(): {
  client_id: string;
  client_secret: string;
  developer_token: string;
} | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret || !developerToken) return null;
  return {
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  };
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
        `Ads refresh-token exchange failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`Ads OAuth: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "Ads OAuth: response missing access_token",
    );
  }
  return json.access_token;
}

type AdsSearchRow = Record<string, unknown>;

async function gaqlSearch(args: {
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
  query: string;
}): Promise<AdsSearchRow[]> {
  const url = `${ADS_API_BASE}/customers/${encodeURIComponent(args.customerId)}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.accessToken}`,
    "developer-token": args.developerToken,
    "content-type": "application/json",
  };
  if (args.loginCustomerId) {
    headers["login-customer-id"] = args.loginCustomerId;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: args.query }),
  });
  if (res.status === 401 || res.status === 403) {
    const text = await res.text();
    throw new CredentialAuthError(
      "EXPIRED",
      `Ads searchStream ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Ads searchStream ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as
    | Array<{ results?: AdsSearchRow[] }>
    | { results?: AdsSearchRow[] };
  // searchStream returns a stream chunk array; non-stream returns one
  // results array. We accept both for forward compatibility.
  if (Array.isArray(json)) {
    return json.flatMap((chunk) => chunk.results ?? []);
  }
  return json.results ?? [];
}

export async function syncAdsForClient(
  clientId: string,
): Promise<{ rows_written: number; skipped?: boolean }> {
  const oauth = getOAuthEnv();
  if (!oauth) {
    logger.warn("optimiser.sync.ads.env_missing", { client_id: clientId });
    return { rows_written: 0, skipped: true };
  }

  // Skip if synced within the last hour.
  const supabase = getServiceRoleClient();
  const { data: cred } = await supabase
    .from("opt_client_credentials")
    .select("last_synced_at")
    .eq("client_id", clientId)
    .eq("source", "google_ads")
    .maybeSingle();
  if (
    cred?.last_synced_at &&
    Date.now() - new Date(cred.last_synced_at as string).getTime() <
      MIN_SYNC_INTERVAL_MS
  ) {
    return { rows_written: 0, skipped: true };
  }

  const secret = await readCredential(clientId, "google_ads");
  const payload = secret.payload as Partial<AdsCredentialPayload>;
  if (!payload.refresh_token || !payload.customer_id) {
    throw new CredentialAuthError(
      "MISCONFIGURED",
      "Ads credential missing refresh_token or customer_id",
    );
  }

  const accessToken = await exchangeRefreshToken(payload.refresh_token, {
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
  });

  let rowsWritten = 0;
  const customerId = payload.customer_id;

  // Campaigns
  const campaignRows = await gaqlSearch({
    accessToken,
    developerToken: oauth.developer_token,
    customerId,
    loginCustomerId: payload.login_customer_id,
    query:
      "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
  });
  for (const row of campaignRows) {
    const c = (row as Record<string, Record<string, unknown>>).campaign;
    if (!c) continue;
    const externalId = String(c.id);
    const channel = (row as Record<string, Record<string, unknown>>)
      .campaign_budget?.amount_micros;
    const { error } = await supabase
      .from("opt_campaigns")
      .upsert(
        {
          client_id: clientId,
          external_id: externalId,
          name: String(c.name ?? "(unnamed)"),
          status: normaliseStatus(c.status),
          channel_type: String(c.advertising_channel_type ?? ""),
          daily_budget_micros: typeof channel === "number" ? channel : null,
          raw: row,
          last_synced_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "client_id,external_id" },
      )
      .select("id");
    if (!error) rowsWritten += 1;
  }

  // Ad groups
  const adGroupRows = await gaqlSearch({
    accessToken,
    developerToken: oauth.developer_token,
    customerId,
    loginCustomerId: payload.login_customer_id,
    query:
      "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'",
  });
  for (const row of adGroupRows) {
    const ag = (row as Record<string, Record<string, unknown>>).ad_group;
    const cmp = (row as Record<string, Record<string, unknown>>).campaign;
    if (!ag || !cmp) continue;
    const { data: campaign } = await supabase
      .from("opt_campaigns")
      .select("id")
      .eq("client_id", clientId)
      .eq("external_id", String(cmp.id))
      .maybeSingle();
    if (!campaign) continue;
    const { error } = await supabase
      .from("opt_ad_groups")
      .upsert(
        {
          client_id: clientId,
          campaign_id: campaign.id,
          external_id: String(ag.id),
          name: String(ag.name ?? "(unnamed)"),
          status: normaliseStatus(ag.status),
          raw: row,
          last_synced_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "client_id,external_id" },
      )
      .select("id");
    if (!error) rowsWritten += 1;
  }

  // Note: Phase 1 ships this scaffold; the keyword / ad / landing-page
  // GAQL queries follow the same shape and are added as live data
  // exposes the GAQL-vs-REST quirks. Each adds one block above.
  // landing_page_view feeds opt_landing_pages + opt_metrics_daily;
  // ad_group_ad feeds opt_ads; ad_group_criterion feeds opt_keywords.

  return { rows_written: rowsWritten };
}

function normaliseStatus(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const v = value.toLowerCase();
  if (v === "enabled" || v === "paused" || v === "removed") return v;
  return "unknown";
}
