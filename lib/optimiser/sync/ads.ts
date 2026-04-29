import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { readCredential } from "../credentials";
import { CredentialAuthError } from "./runner";

// ---------------------------------------------------------------------------
// Google Ads sync (spec §4.1).
//
// Phase 1 reads (Slice 7 completes the set):
//   - campaign            → opt_campaigns
//   - ad_group            → opt_ad_groups (+ top_search_terms aggregated in raw)
//   - ad_group_criterion  → opt_keywords  (positive keywords with KEYWORD type)
//   - ad_group_ad         → opt_ads       (RSA headlines + descriptions + final_url)
//   - landing_page_view   → opt_landing_pages (+ opt_metrics_daily 30-day rollup)
//   - search_term_view    → opt_ad_groups.raw.top_search_terms (Phase 1 surface;
//                           the alignment scorer reads them from there)
//
// Auth: the OAuth refresh token + customer id are read from
// opt_client_credentials.payload (JSON). The refresh token is exchanged
// for a fresh access token at the start of each sync; we never persist
// access tokens.
//
// Endpoint: googleads.googleapis.com/v17/customers/{customer_id}/googleAds:searchStream
// — GAQL query, paginated by token.
//
// All writes are idempotent UPSERTs keyed by (client_id, external_id) /
// (ad_group_id, external_id) / (landing_page_id, metric_date, source,
// dimension). A rerun of the same day's data is a no-op.
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

  const ctx: SyncCtx = {
    clientId,
    accessToken,
    developerToken: oauth.developer_token,
    customerId: payload.customer_id,
    loginCustomerId: payload.login_customer_id,
  };

  let rowsWritten = 0;

  rowsWritten += await syncCampaigns(ctx);
  rowsWritten += await syncAdGroups(ctx);
  rowsWritten += await syncKeywords(ctx);
  rowsWritten += await syncAds(ctx);
  rowsWritten += await syncLandingPages(ctx);
  rowsWritten += await syncSearchTerms(ctx);

  return { rows_written: rowsWritten };
}

type SyncCtx = {
  clientId: string;
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
};

async function syncCampaigns(ctx: SyncCtx): Promise<number> {
  const supabase = getServiceRoleClient();
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query:
      "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
  });
  let n = 0;
  for (const row of rows) {
    const c = (row as Record<string, Record<string, unknown>>).campaign;
    if (!c) continue;
    const externalId = String(c.id);
    const channel = (row as Record<string, Record<string, unknown>>)
      .campaign_budget?.amount_micros;
    const { error } = await supabase
      .from("opt_campaigns")
      .upsert(
        {
          client_id: ctx.clientId,
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
    if (!error) n += 1;
  }
  return n;
}

async function syncAdGroups(ctx: SyncCtx): Promise<number> {
  const supabase = getServiceRoleClient();
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query:
      "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'",
  });
  let n = 0;
  for (const row of rows) {
    const ag = (row as Record<string, Record<string, unknown>>).ad_group;
    const cmp = (row as Record<string, Record<string, unknown>>).campaign;
    if (!ag || !cmp) continue;
    const { data: campaign } = await supabase
      .from("opt_campaigns")
      .select("id")
      .eq("client_id", ctx.clientId)
      .eq("external_id", String(cmp.id))
      .maybeSingle();
    if (!campaign) continue;
    const { error } = await supabase
      .from("opt_ad_groups")
      .upsert(
        {
          client_id: ctx.clientId,
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
    if (!error) n += 1;
  }
  return n;
}

async function syncKeywords(ctx: SyncCtx): Promise<number> {
  // ad_group_criterion is the right resource for positive keywords in
  // Google Ads API v17. type = KEYWORD filters out audience / negative
  // criteria. status != 'REMOVED' drops dead rows. We only ingest
  // search-network keywords; campaign type is filtered upstream by
  // status='ENABLED' on the campaign.
  const supabase = getServiceRoleClient();
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query:
      "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.id FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'",
  });
  let n = 0;
  // Cache ad_group lookups per ad-group external_id within this sync
  // tick to avoid an N+1 against opt_ad_groups for fleets with many
  // keywords.
  const adGroupCache = new Map<string, string>();
  for (const row of rows) {
    const crit = (row as Record<string, Record<string, unknown>>)
      .ad_group_criterion;
    const ag = (row as Record<string, Record<string, unknown>>).ad_group;
    if (!crit || !ag) continue;
    const kw = (crit.keyword ?? {}) as Record<string, unknown>;
    if (!kw.text) continue;
    const adGroupExternalId = String(ag.id);
    let adGroupId = adGroupCache.get(adGroupExternalId);
    if (!adGroupId) {
      const { data: row2 } = await supabase
        .from("opt_ad_groups")
        .select("id")
        .eq("client_id", ctx.clientId)
        .eq("external_id", adGroupExternalId)
        .maybeSingle();
      if (!row2) continue;
      adGroupId = row2.id as string;
      adGroupCache.set(adGroupExternalId, adGroupId);
    }
    const { error } = await supabase
      .from("opt_keywords")
      .upsert(
        {
          client_id: ctx.clientId,
          ad_group_id: adGroupId,
          external_id: String(crit.criterion_id),
          text: String(kw.text),
          match_type: normaliseMatchType(kw.match_type),
          status: normaliseStatus(crit.status),
          raw: row,
          last_synced_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "ad_group_id,external_id" },
      )
      .select("id");
    if (!error) n += 1;
  }
  return n;
}

async function syncAds(ctx: SyncCtx): Promise<number> {
  // ad_group_ad covers all ad types. Phase 1 cares about RESPONSIVE_SEARCH_AD
  // primarily — the alignment scorer reads headlines + descriptions from
  // there. We persist the raw row so future passes can pick up other
  // ad types (e.g. expanded text ads on legacy accounts) without a
  // re-sync.
  const supabase = getServiceRoleClient();
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query:
      "SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
  });
  let n = 0;
  const adGroupCache = new Map<string, string>();
  for (const row of rows) {
    const ad = (row as Record<string, Record<string, unknown>>).ad_group_ad;
    const ag = (row as Record<string, Record<string, unknown>>).ad_group;
    if (!ad || !ag) continue;
    const adInner = (ad.ad ?? {}) as Record<string, unknown>;
    if (!adInner.id) continue;
    const adGroupExternalId = String(ag.id);
    let adGroupId = adGroupCache.get(adGroupExternalId);
    if (!adGroupId) {
      const { data: row2 } = await supabase
        .from("opt_ad_groups")
        .select("id")
        .eq("client_id", ctx.clientId)
        .eq("external_id", adGroupExternalId)
        .maybeSingle();
      if (!row2) continue;
      adGroupId = row2.id as string;
      adGroupCache.set(adGroupExternalId, adGroupId);
    }
    const rsa = (adInner.responsive_search_ad ?? {}) as Record<string, unknown>;
    const headlines = extractAssetTexts(rsa.headlines);
    const descriptions = extractAssetTexts(rsa.descriptions);
    const finalUrls = Array.isArray(adInner.final_urls)
      ? (adInner.final_urls as string[])
      : [];
    const { error } = await supabase
      .from("opt_ads")
      .upsert(
        {
          client_id: ctx.clientId,
          ad_group_id: adGroupId,
          external_id: String(adInner.id),
          ad_type: String(adInner.type ?? "unknown").toLowerCase(),
          status: normaliseStatus(ad.status),
          headlines,
          descriptions,
          final_url: finalUrls[0] ?? null,
          raw: row,
          last_synced_at: new Date().toISOString(),
          deleted_at: null,
        },
        { onConflict: "ad_group_id,external_id" },
      )
      .select("id");
    if (!error) n += 1;
  }
  return n;
}

/**
 * Asset texts come back as either an array of strings (legacy) or an
 * array of `{ text }` / `{ asset_text }` objects depending on Ads API
 * version. We accept both shapes and dedupe.
 */
function extractAssetTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      out.add(item);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const text =
        (obj.text as string | undefined) ??
        (obj.asset_text as string | undefined) ??
        (typeof obj.asset === "string" ? (obj.asset as string) : undefined);
      if (text) out.add(text);
    }
  }
  return [...out];
}

async function syncLandingPages(ctx: SyncCtx): Promise<number> {
  // landing_page_view returns one row per (final URL, segments.date)
  // with attribution metrics. We aggregate over the last 30 days into:
  //   - opt_landing_pages: spend_30d_usd_cents + sessions_30d cached
  //     columns (so the bulk-page-select screen sorts without a join)
  //   - opt_metrics_daily: per-day rollup with source='google_ads',
  //     dimension_key='', dimension_value=''
  // Only auto-creates an opt_landing_pages row if it didn't exist yet —
  // staff still control managed=true via §7.4.
  const supabase = getServiceRoleClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = formatGaDate(since);
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query: `SELECT landing_page_view.unexpanded_final_url, segments.date, metrics.clicks, metrics.cost_micros, metrics.impressions, metrics.conversions, metrics.average_cpc FROM landing_page_view WHERE segments.date >= '${sinceDate}'`,
  });

  // Aggregate by URL for the cached 30-day fields on opt_landing_pages.
  type Aggregate = {
    spend_micros: number;
    clicks: number;
    impressions: number;
    conversions: number;
  };
  const byUrl = new Map<string, Aggregate>();
  // And by (URL, date) for the per-day metrics_daily rows.
  const byUrlDate = new Map<
    string,
    Map<string, Aggregate>
  >();

  for (const row of rows) {
    const lpv = (row as Record<string, Record<string, unknown>>)
      .landing_page_view;
    const seg = (row as Record<string, Record<string, unknown>>).segments;
    const m = (row as Record<string, Record<string, unknown>>).metrics;
    if (!lpv || !seg || !m) continue;
    const url = String(lpv.unexpanded_final_url ?? "");
    if (!url) continue;
    const date = String(seg.date ?? "");
    if (!date) continue;
    const cost = numericOrZero(m.cost_micros);
    const clicks = numericOrZero(m.clicks);
    const impressions = numericOrZero(m.impressions);
    const conversions = numericOrZero(m.conversions);

    const agg = byUrl.get(url) ?? {
      spend_micros: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    agg.spend_micros += cost;
    agg.clicks += clicks;
    agg.impressions += impressions;
    agg.conversions += conversions;
    byUrl.set(url, agg);

    let dateMap = byUrlDate.get(url);
    if (!dateMap) {
      dateMap = new Map();
      byUrlDate.set(url, dateMap);
    }
    const dayAgg = dateMap.get(date) ?? {
      spend_micros: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
    };
    dayAgg.spend_micros += cost;
    dayAgg.clicks += clicks;
    dayAgg.impressions += impressions;
    dayAgg.conversions += conversions;
    dateMap.set(date, dayAgg);
  }

  let n = 0;

  // 1. Upsert opt_landing_pages rows. Convert micros to cents
  //    (cost_micros is USD * 1_000_000 → / 10_000 = cents).
  for (const [url, agg] of byUrl) {
    const spendCents = Math.round(agg.spend_micros / 10_000);
    const { data: existing } = await supabase
      .from("opt_landing_pages")
      .select("id")
      .eq("client_id", ctx.clientId)
      .eq("url", url)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("opt_landing_pages")
        .update({
          spend_30d_usd_cents: spendCents,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id as string);
      if (!error) n += 1;
    } else {
      // Auto-create as managed=false so the bulk-select screen surfaces
      // the URL without committing the engine to optimising it.
      const { error } = await supabase
        .from("opt_landing_pages")
        .insert({
          client_id: ctx.clientId,
          url,
          managed: false,
          management_mode: "read_only",
          state: "insufficient_data",
          spend_30d_usd_cents: spendCents,
        });
      if (!error) n += 1;
    }
  }

  // 2. Upsert per-day metrics_daily rows.
  for (const [url, dateMap] of byUrlDate) {
    const { data: page } = await supabase
      .from("opt_landing_pages")
      .select("id")
      .eq("client_id", ctx.clientId)
      .eq("url", url)
      .is("deleted_at", null)
      .maybeSingle();
    if (!page) continue;
    for (const [gaDate, agg] of dateMap) {
      const isoDate = parseGaDate(gaDate);
      const { error } = await supabase.from("opt_metrics_daily").upsert(
        {
          client_id: ctx.clientId,
          landing_page_id: page.id as string,
          metric_date: isoDate,
          source: "google_ads",
          dimension_key: "",
          dimension_value: "",
          metrics: {
            cost_usd_cents: Math.round(agg.spend_micros / 10_000),
            clicks: agg.clicks,
            impressions: agg.impressions,
            conversions: agg.conversions,
          },
          ingested_at: new Date().toISOString(),
        },
        {
          onConflict:
            "landing_page_id,metric_date,source,dimension_key,dimension_value",
        },
      );
      if (!error) n += 1;
    }
  }
  return n;
}

async function syncSearchTerms(ctx: SyncCtx): Promise<number> {
  // search_term_view returns the raw search queries that triggered an
  // ad. The alignment scorer (Slice 5) consumes them as input for the
  // intent_match sub-score. Phase 1 surface: aggregate top 30 search
  // terms per ad_group into opt_ad_groups.raw.top_search_terms (sorted
  // by impressions desc). The alignment scorer reads them from there;
  // no new schema needed.
  const supabase = getServiceRoleClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = formatGaDate(since);
  const rows = await gaqlSearch({
    accessToken: ctx.accessToken,
    developerToken: ctx.developerToken,
    customerId: ctx.customerId,
    loginCustomerId: ctx.loginCustomerId,
    query: `SELECT search_term_view.search_term, ad_group.id, metrics.impressions, metrics.clicks, metrics.conversions FROM search_term_view WHERE segments.date >= '${sinceDate}'`,
  });

  type TermAgg = { term: string; impressions: number; clicks: number; conversions: number };
  const byAdGroup = new Map<string, Map<string, TermAgg>>();
  for (const row of rows) {
    const stv = (row as Record<string, Record<string, unknown>>)
      .search_term_view;
    const ag = (row as Record<string, Record<string, unknown>>).ad_group;
    const m = (row as Record<string, Record<string, unknown>>).metrics;
    if (!stv || !ag || !m) continue;
    const term = String(stv.search_term ?? "").trim();
    if (!term) continue;
    const adGroupExternalId = String(ag.id);
    let perAdGroup = byAdGroup.get(adGroupExternalId);
    if (!perAdGroup) {
      perAdGroup = new Map();
      byAdGroup.set(adGroupExternalId, perAdGroup);
    }
    const agg = perAdGroup.get(term) ?? {
      term,
      impressions: 0,
      clicks: 0,
      conversions: 0,
    };
    agg.impressions += numericOrZero(m.impressions);
    agg.clicks += numericOrZero(m.clicks);
    agg.conversions += numericOrZero(m.conversions);
    perAdGroup.set(term, agg);
  }

  let n = 0;
  for (const [adGroupExternalId, perAdGroup] of byAdGroup) {
    const top = [...perAdGroup.values()]
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 30);
    const { data: existing } = await supabase
      .from("opt_ad_groups")
      .select("id, raw")
      .eq("client_id", ctx.clientId)
      .eq("external_id", adGroupExternalId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!existing) continue;
    const raw = (existing.raw as Record<string, unknown> | null) ?? {};
    const merged = { ...raw, top_search_terms: top };
    const { error } = await supabase
      .from("opt_ad_groups")
      .update({
        raw: merged,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
    if (!error) n += 1;
  }
  return n;
}

function numericOrZero(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normaliseStatus(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const v = value.toLowerCase();
  if (v === "enabled" || v === "paused" || v === "removed") return v;
  return "unknown";
}

function normaliseMatchType(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const v = value.toLowerCase();
  if (v === "exact" || v === "phrase" || v === "broad") return v;
  return "unknown";
}

function formatGaDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseGaDate(s: string): string {
  // Ads returns YYYY-MM-DD already; just pass through.
  return s;
}
