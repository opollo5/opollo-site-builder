// ---------------------------------------------------------------------------
// Pinned production URL constants.
//
// These are the source of truth for the config-drift detector
// (.github/workflows/config-drift.yml) and for regression tests that
// pin against domain typos. The historic outage caused by
// `opollo.vercel.app` (stale) vs `opollo-site-builder.vercel.app`
// (active) is the canary — encoding the canonical domain here means
// any rename of the Vercel project surfaces as a diff in this file
// during the PR review.
// ---------------------------------------------------------------------------

export const PRODUCTION_DOMAIN = "https://opollo-site-builder.vercel.app";

export const EXPECTED_BUNDLESOCIAL_WEBHOOK_URL = `${PRODUCTION_DOMAIN}/api/webhooks/bundlesocial`;

export const EXPECTED_BUNDLESOCIAL_CONNECT_CALLBACK_PREFIX = `${PRODUCTION_DOMAIN}/api/platform/social/connections/callback`;

export const EXPECTED_QSTASH_DESTINATION_PREFIX = `${PRODUCTION_DOMAIN}/api/webhooks/qstash`;
