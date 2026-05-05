import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// OAuth helpers shared by the Ads + GA4 onboarding flows.
//
// Phase 1 implements the standard Google OAuth 2.0 web flow:
//   1. UI calls /api/optimiser/oauth/{source}/start?client_id=<opt_client_id>
//   2. Handler builds the consent URL, sets a signed state cookie,
//      302-redirects to accounts.google.com.
//   3. Google calls /api/optimiser/oauth/{source}/callback?code=...&state=...
//   4. Handler verifies the state cookie, exchanges code for refresh
//      token, persists into opt_client_credentials, redirects back to
//      /optimiser/onboarding/<client_id>.
//
// state is a JSON-encoded { opt_client_id, source, nonce } pair signed
// with HMAC-SHA256 keyed off OPOLLO_MASTER_KEY. We reuse the master
// key rather than introducing a new secret — the signing is for CSRF
// protection only, the payload itself isn't sensitive.
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthSource = "google_ads" | "ga4";

export type OAuthState = {
  opt_client_id: string;
  source: OAuthSource;
  nonce: string;
  ts: number;
};

function getSigningKey(): Buffer {
  const encoded = process.env.OPOLLO_MASTER_KEY;
  if (!encoded) {
    throw new Error("OPOLLO_MASTER_KEY is not set; OAuth state cannot be signed.");
  }
  return Buffer.from(encoded, "base64");
}

export function signState(state: Omit<OAuthState, "nonce" | "ts">): string {
  const fullState: OAuthState = {
    ...state,
    nonce: randomBytes(16).toString("base64url"),
    ts: Date.now(),
  };
  const json = JSON.stringify(fullState);
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const key = getSigningKey();
  const sig = createHmac("sha256", key)
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(token: string): OAuthState | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const key = getSigningKey();
  const expectedSig = createHmac("sha256", key)
    .update(payload, "utf8")
    .digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (
    expectedSig.length !== providedSig.length ||
    !timingSafeEqual(expectedSig, providedSig)
  ) {
    return null;
  }
  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (Date.now() - parsed.ts > STATE_TTL_MS) return null;
  return parsed;
}

export function adsConsentUrl(args: {
  redirectUri: string;
  state: string;
}): string | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state: args.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function ga4ConsentUrl(args: {
  redirectUri: string;
  state: string;
}): string | null {
  // GA4 reuses the Google Ads OAuth client.
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    access_type: "offline",
    prompt: "consent",
    state: args.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(args: {
  code: string;
  redirectUri: string;
  source: OAuthSource;
}): Promise<{ refresh_token: string; access_token: string } | null> {
  // Both Ads and GA4 use the same Google OAuth client.
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: args.code,
    grant_type: "authorization_code",
    redirect_uri: args.redirectUri,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
  };
  if (!json.refresh_token || !json.access_token) return null;
  return {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
  };
}
