import "server-only";

import { logger } from "@/lib/logger";
import { readCredential, markCredentialError } from "./credentials";

// ---------------------------------------------------------------------------
// Verify-step probes for the onboarding wizard.
//
// Each function tries the minimum API call that demonstrates the
// credential works:
//   - Ads:    list 1 campaign for the customer_id
//   - Clarity: pull 1 day of insights, look for at least one session
//   - GA4:    runReport with sessions, expect ≥ 1 row
//
// On success: returns { ok: true, evidence }.
// On API auth failure: flips the credential row's status to expired
// and returns { ok: false, kind: "auth" }.
// On no-data failure (Clarity hasn't received its first session yet,
// GA4 has no goals): returns { ok: false, kind: "no_data" }.
// ---------------------------------------------------------------------------

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type VerifyResult =
  | { ok: true; evidence?: Record<string, unknown> }
  | { ok: false; kind: "auth" | "no_data" | "config" | "system"; message: string };

async function exchangeRefreshToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export async function verifyAds(clientId: string): Promise<VerifyResult> {
  const oauthClient = process.env.GOOGLE_ADS_CLIENT_ID;
  const oauthSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!oauthClient || !oauthSecret || !developerToken) {
    return {
      ok: false,
      kind: "system",
      message: "Ads OAuth env not provisioned. Contact ops.",
    };
  }
  let secret;
  try {
    secret = await readCredential(clientId, "google_ads");
  } catch (err) {
    return {
      ok: false,
      kind: "config",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const payload = secret.payload as {
    refresh_token?: string;
    customer_id?: string;
    login_customer_id?: string;
  };
  if (!payload.refresh_token || !payload.customer_id) {
    return {
      ok: false,
      kind: "config",
      message: "Ads credential missing refresh_token or customer_id.",
    };
  }
  const accessToken = await exchangeRefreshToken({
    refreshToken: payload.refresh_token,
    clientId: oauthClient,
    clientSecret: oauthSecret,
  });
  if (!accessToken) {
    await markCredentialError(
      clientId,
      "google_ads",
      "expired",
      "REFRESH_FAILED",
      "Refresh token exchange failed",
    );
    return {
      ok: false,
      kind: "auth",
      message: "Refresh token exchange failed. Re-connect Google Ads.",
    };
  }
  const url = `https://googleads.googleapis.com/v17/customers/${encodeURIComponent(payload.customer_id)}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "content-type": "application/json",
  };
  if (payload.login_customer_id) {
    headers["login-customer-id"] = payload.login_customer_id;
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query:
        "SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED' LIMIT 1",
    }),
  });
  if (res.status === 401 || res.status === 403) {
    await markCredentialError(
      clientId,
      "google_ads",
      "expired",
      `HTTP_${res.status}`,
      "Ads searchStream rejected the access token.",
    );
    return {
      ok: false,
      kind: "auth",
      message: "Google Ads rejected the credential. Re-connect.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: "system",
      message: `Ads API error: ${res.status}`,
    };
  }
  const json = (await res.json()) as
    | Array<{ results?: unknown[] }>
    | { results?: unknown[] };
  const rows = Array.isArray(json)
    ? json.flatMap((c) => c.results ?? [])
    : json.results ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      kind: "no_data",
      message: "No active campaigns found — engine has nothing to optimise.",
    };
  }
  return { ok: true, evidence: { active_campaigns: rows.length } };
}

export async function verifyClarity(clientId: string): Promise<VerifyResult> {
  let secret;
  try {
    secret = await readCredential(clientId, "clarity");
  } catch (err) {
    return {
      ok: false,
      kind: "config",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const apiToken = (secret.payload as { api_token?: string }).api_token;
  if (!apiToken) {
    return {
      ok: false,
      kind: "config",
      message: "Clarity API token not set.",
    };
  }
  const res = await fetch(
    "https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1",
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (res.status === 401 || res.status === 403) {
    await markCredentialError(
      clientId,
      "clarity",
      "misconfigured",
      `HTTP_${res.status}`,
      "Clarity API rejected the token.",
    );
    return {
      ok: false,
      kind: "auth",
      message: "Clarity rejected the API token.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: "system",
      message: `Clarity API error: ${res.status}`,
    };
  }
  const rows = (await res.json()) as Array<{ information?: unknown[] }>;
  const totalSessions = rows.reduce((acc, r) => acc + (r.information?.length ?? 0), 0);
  if (totalSessions === 0) {
    return {
      ok: false,
      kind: "no_data",
      message: "Waiting for first Clarity session.",
    };
  }
  return { ok: true, evidence: { sessions_seen: totalSessions } };
}

export async function verifyGa4(clientId: string): Promise<VerifyResult> {
  // GA4 reuses the shared Google Ads OAuth client.
  const oauthClient = process.env.GOOGLE_ADS_CLIENT_ID;
  const oauthSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!oauthClient || !oauthSecret) {
    return {
      ok: false,
      kind: "system",
      message: "GA4 OAuth env not provisioned.",
    };
  }
  let secret;
  try {
    secret = await readCredential(clientId, "ga4");
  } catch (err) {
    return {
      ok: false,
      kind: "config",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const payload = secret.payload as {
    refresh_token?: string;
    property_id?: string;
  };
  if (!payload.refresh_token || !payload.property_id) {
    return {
      ok: false,
      kind: "config",
      message: "GA4 credential missing refresh_token or property_id.",
    };
  }
  const accessToken = await exchangeRefreshToken({
    refreshToken: payload.refresh_token,
    clientId: oauthClient,
    clientSecret: oauthSecret,
  });
  if (!accessToken) {
    await markCredentialError(
      clientId,
      "ga4",
      "expired",
      "REFRESH_FAILED",
      "GA4 refresh-token exchange failed",
    );
    return {
      ok: false,
      kind: "auth",
      message: "GA4 refresh token exchange failed. Re-connect.",
    };
  }
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(payload.property_id)}:runReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      metrics: [{ name: "sessions" }, { name: "conversions" }],
    }),
  });
  if (res.status === 401 || res.status === 403) {
    await markCredentialError(
      clientId,
      "ga4",
      "expired",
      `HTTP_${res.status}`,
      "GA4 runReport rejected the access token.",
    );
    return {
      ok: false,
      kind: "auth",
      message: "GA4 rejected the credential. Re-connect.",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: "system",
      message: `GA4 API error: ${res.status}`,
    };
  }
  type Row = {
    metricValues?: Array<{ value?: string }>;
  };
  const json = (await res.json()) as { rows?: Row[] };
  const rows = json.rows ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      kind: "no_data",
      message: "GA4 returned no rows for the last 7 days.",
    };
  }
  // Soft-warn surface (per §7.3): no goals → log + still return ok so
  // staff can proceed.
  const conversions = rows.reduce(
    (acc, r) => acc + Number(r.metricValues?.[1]?.value ?? 0),
    0,
  );
  if (conversions === 0) {
    await markCredentialError(
      clientId,
      "ga4",
      "misconfigured",
      "NO_GOALS",
      "GA4 has no conversions configured. Engine will fall back to traffic + behaviour signals.",
    );
    logger.info("optimiser.verify.ga4.no_goals", { client_id: clientId });
  }
  return {
    ok: true,
    evidence: { rows_seen: rows.length, conversions_seen: conversions },
  };
}
