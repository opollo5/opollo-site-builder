import "server-only";

import { Bundlesocial } from "bundlesocial";

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// bundle.social SDK wrapper.
//
// Lazy singleton over the official `bundlesocial` SDK. Returns null
// when env vars aren't set so tests + local dev stay no-op rather
// than hard-failing at module load. Same pattern as lib/qstash.ts +
// lib/redis.ts.
//
// Env contract:
//   BUNDLE_SOCIAL_API                    — API key from the bundle.social
//                                          dashboard (server only; never
//                                          ship to the client).
//   BUNDLE_SOCIAL_TEAM_ID                — required for create-portal-link
//                                          and connect endpoints; bundle.
//                                          social's API is team-scoped
//                                          even though the SDK constructor
//                                          only takes the API key.
//   BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET  — verifies inbound webhook
//                                          signatures (HMAC-SHA256 in
//                                          x-signature header). Bundle's
//                                          docs are emphatic: required
//                                          even in development.
//
// Callers that need to publish or initiate connects MUST check the
// returned client for null and fall back to a degraded path (route
// returns 503 RECEIVER_NOT_CONFIGURED, or feature-flag the surface
// off). Webhook routes do the same with the signing secret.
// ---------------------------------------------------------------------------

let cached: Bundlesocial | null | undefined = undefined;

export function getBundlesocialClient(): Bundlesocial | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.BUNDLE_SOCIAL_API;
  if (!apiKey) {
    cached = null;
    return null;
  }
  cached = new Bundlesocial(apiKey);
  return cached;
}

export function getBundlesocialTeamId(): string | null {
  return process.env.BUNDLE_SOCIAL_TEAM_ID ?? null;
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_secret" | "missing_signature" | "invalid" };

// Verifies the x-signature header against the raw body using
// HMAC-SHA256 of the signing secret. Returns `no_secret` when env
// is unset (tests + local dev). Webhook routes MUST treat
// `no_secret` as a config error in production.
//
// We compute the HMAC ourselves rather than reaching into the SDK
// internals so the verifier stays testable without instantiating
// a client.
export async function verifyBundlesocialSignature(args: {
  signature: string | null;
  rawBody: string;
}): Promise<WebhookVerifyResult> {
  const secret = process.env.BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!args.signature) return { ok: false, reason: "missing_signature" };

  try {
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", secret)
      .update(args.rawBody)
      .digest("hex");

    // Constant-time compare. Bail early when length differs to avoid
    // timing leaks.
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(args.signature, "utf8");
    if (expectedBuf.length !== providedBuf.length) {
      return { ok: false, reason: "invalid" };
    }
    if (!timingSafeEqual(expectedBuf, providedBuf)) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true };
  } catch (err) {
    logger.warn("bundlesocial.verify_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "invalid" };
  }
}

export function __resetBundlesocialForTests(): void {
  cached = undefined;
}
