import { NextResponse, type NextRequest } from "next/server";

import { enqueuePostHistoryImport } from "@/lib/platform/social/analytics-ingest";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { CHANNEL_SELECTION_PLATFORMS } from "@/lib/platform/social/connections/identity";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// bundle.social OAuth callback param handling.
//
// bundle.social has two param formats:
//
// OLD (per-platform named params, pre-2026-05-18 deploy):
//   ?<platform>-callback=true|error
//   ?<platform>-not-enough-channels  (presence indicates error)
//   ?not-enough-permissions           (legacy generic)
//
// NEW (?success=<code> / ?error=<code>, post-2026-05-18 deploy):
//   ?success=linkedin-callback
//   ?error=linkedin-not-enough-channels
//   ?error=instagram-not-professional-account
//
// The code after ?success= / ?error= is the same string that was
// previously the param NAME in the old format. We support both formats
// so the transition window is seamless.
//
// Source: https://info.bundle.social/api-reference/connect-social-accounts
// ---------------------------------------------------------------------------

// Internal platform keys used throughout this file.
const PLATFORM_KEYS = [
  "linkedin",
  "facebook",
  "instagram",
  "twitter",
  "threads",
  "tiktok",
  "youtube",
  "google_business",
  "pinterest",
  "reddit",
  "bluesky",
  "mastodon",
  "discord",
  "slack",
] as const;

type PlatformKey = (typeof PLATFORM_KEYS)[number];

// bundle.social uses hyphens in codes (google-business-callback) but our
// internal PLATFORM_KEYS uses underscores (google_business).  Map longest
// prefix first so "google-business" is matched before a hypothetical bare
// "google" prefix.
const BUNDLE_PREFIX_TO_KEY: Array<{ prefix: string; key: PlatformKey }> = [
  { prefix: "google-business", key: "google_business" },
  { prefix: "linkedin",        key: "linkedin" },
  { prefix: "facebook",        key: "facebook" },
  { prefix: "instagram",       key: "instagram" },
  { prefix: "twitter",         key: "twitter" },
  { prefix: "threads",         key: "threads" },
  { prefix: "tiktok",          key: "tiktok" },
  { prefix: "youtube",         key: "youtube" },
  { prefix: "pinterest",       key: "pinterest" },
  { prefix: "reddit",          key: "reddit" },
  { prefix: "bluesky",         key: "bluesky" },
  { prefix: "mastodon",        key: "mastodon" },
  { prefix: "discord",         key: "discord" },
  { prefix: "slack",           key: "slack" },
];

// Error suffix → reason code.  Used for both the new-format error codes
// (?error=<platform><suffix>) and the old-format named params
// (?<platform><suffix>).
const ERROR_SUFFIX_TO_REASON: Array<{ suffix: string; reason: string }> = [
  { suffix: "-not-enough-channels",        reason: "not-enough-channels" },
  { suffix: "-not-enough-permissions",     reason: "not-enough-permissions" },
  { suffix: "-not-enough-pages",           reason: "not-enough-pages" },
  { suffix: "-not-enough-accounts",        reason: "not-enough-accounts" },
  { suffix: "-not-enough-servers",         reason: "not-enough-servers" },
  { suffix: "-not-enough-workspaces",      reason: "not-enough-workspaces" },
  // New in bundle.social 2026-05-18 deploy:
  { suffix: "-not-professional-account",   reason: "not-professional-account" },
  // Generic auth fail when code ends in -callback or -direct-callback via
  // ?error= param:
  { suffix: "-direct-callback",            reason: "auth-failed" },
  { suffix: "-callback",                   reason: "auth-failed" },
];

// Resolve a bundle.social platform code prefix → our PlatformKey.
function matchBundlePrefix(code: string): PlatformKey | null {
  for (const { prefix, key } of BUNDLE_PREFIX_TO_KEY) {
    if (code.startsWith(prefix)) return key;
  }
  return null;
}

type ClassifyResult =
  | { kind: "success";        platform: PlatformKey }
  | { kind: "error";          platform: PlatformKey; reason: string }
  | { kind: "unknown_success"; code: string }
  | { kind: "unknown_error";   code: string }
  | null;

// Scan the URL for bundle.social OAuth outcome signals and classify them.
// Returns null when no signal is present — the caller falls through to the
// sync-driven outcome.
function classifyPlatformParams(url: URL): ClassifyResult {
  // -----------------------------------------------------------------------
  // NEW FORMAT: ?success=<code> or ?error=<code>
  // -----------------------------------------------------------------------
  const successCode = url.searchParams.get("success");
  if (successCode !== null) {
    const platform = matchBundlePrefix(successCode);
    if (platform) {
      // Any -callback or -direct-callback suffix is a success signal.
      const suffix = successCode.slice(
        BUNDLE_PREFIX_TO_KEY.find((e) => e.key === platform)!.prefix.length,
      );
      if (suffix === "-callback" || suffix === "-direct-callback") {
        return { kind: "success", platform };
      }
    }
    // Unknown success code — log and show generic error (see handler).
    return { kind: "unknown_success", code: successCode };
  }

  const errorCode = url.searchParams.get("error");
  if (errorCode !== null) {
    const platform = matchBundlePrefix(errorCode);
    if (platform) {
      const suffix = errorCode.slice(
        BUNDLE_PREFIX_TO_KEY.find((e) => e.key === platform)!.prefix.length,
      );
      for (const { suffix: s, reason } of ERROR_SUFFIX_TO_REASON) {
        if (suffix === s) return { kind: "error", platform, reason };
      }
      // Known platform, unrecognised suffix → generic auth fail.
      return { kind: "error", platform, reason: "auth-failed" };
    }
    // Unknown platform prefix — log and show generic error.
    return { kind: "unknown_error", code: errorCode };
  }

  // -----------------------------------------------------------------------
  // OLD FORMAT — backward compat for deployments still sending named params.
  // -----------------------------------------------------------------------

  // Legacy generic keys (pre-platform-prefix era and our own ad-hoc signals
  // from PR #868). Use "linkedin" as synthetic platform — the UI only shows
  // the reason copy, not the platform name for these legacy paths.
  for (const key of [
    "not-enough-permissions",
    "not-enough-pages",
    "auth-failed",
    "user-cancelled",
  ]) {
    if (url.searchParams.has(key)) {
      return { kind: "error", platform: "linkedin", reason: key };
    }
  }

  // Platform-prefixed named params: ?<platform>-callback=true|error and
  // ?<platform>-<error-suffix>.
  for (const platform of PLATFORM_KEYS) {
    const cb = url.searchParams.get(`${platform}-callback`);
    if (cb !== null) {
      if (cb === "error") return { kind: "error", platform, reason: "auth-failed" };
      return { kind: "success", platform };
    }
    for (const { suffix, reason } of ERROR_SUFFIX_TO_REASON) {
      // Skip the -callback / -direct-callback suffixes here; they only apply
      // via the ?error= new-format path (not as standalone named params).
      if (suffix === "-callback" || suffix === "-direct-callback") continue;
      if (url.searchParams.has(`${platform}${suffix}`)) {
        return { kind: "error", platform, reason };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// S1-16 — GET /api/platform/social/connections/callback
//
// bundle.social redirects here after the OAuth dance completes (or
// errors). Query params:
//   company_id             — set by /connect when minting the portal URL
//   popup=1                — present when the flow ran in a popup window;
//                            triggers postMessage + window.close() instead
//                            of a full-page redirect.
//   success=<code> /       — NEW bundle.social format (2026-05-18 deploy).
//   error=<code>
//   <platform>-callback=   — OLD bundle.social format (still supported).
//   <platform>-<suffix>
//   not-enough-permissions / etc — legacy generic error signals.
//
// Non-popup behaviour: 302 redirect back to /company/social/connections
// with ?connect=success|error|noop.
//
// Popup behaviour (?popup=1): return an HTML page that sends a
// postMessage to window.opener then calls window.close(). The parent
// connections page listens for the message and calls router.refresh().
//
// Gate: canDo("manage_connections", company_id). The browser carrying
// the bundle.social redirect IS the admin who started the flow, so the
// session cookie is intact.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

function popupCloseResponse(
  req: NextRequest,
  connectParam: string,
  reason?: string,
  connectionId?: string,
  attemptedPlatform?: string,
): NextResponse {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;

  const payload = JSON.stringify({
    type: "bundle-connect-complete",
    connect: connectParam,
    ...(reason ? { reason } : {}),
    ...(connectionId ? { connection_id: connectionId } : {}),
    ...(attemptedPlatform ? { attempted_platform: attemptedPlatform } : {}),
  });

  // Strict target origin — only our own origin accepts this message.
  // No user-controlled data is embedded in the script.
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Connecting…</title></head>
<body>
<script>
(function () {
  var targetOrigin = ${JSON.stringify(origin)};
  var payload = ${payload};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, targetOrigin);
    }
  } catch (e) {
    // opener may be cross-origin in error paths; silently discard
  }
  window.close();
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  const isPopup = url.searchParams.get("popup") === "1";

  if (!companyId || !UUID_RE.test(companyId)) {
    if (isPopup) return popupCloseResponse(req, "error", "invalid-company");
    return NextResponse.redirect(
      new URL("/company/social/connections?connect=error", req.url),
    );
  }

  const gate = await requireCanDoForApi(companyId, "manage_connections");
  if (gate.kind === "deny") {
    if (isPopup) return popupCloseResponse(req, "error", "unauthorized");
    return gate.response;
  }

  // Classify URL params BEFORE running the sync — bundle.social error
  // signals mean OAuth never completed (no account created), so the sync
  // would just no-op and produce a misleading "noop" banner.
  const classified = classifyPlatformParams(url);

  // Unknown code: log to platform_events so ops can investigate, then
  // show a generic error to the user (we can't determine the outcome).
  if (
    classified?.kind === "unknown_success" ||
    classified?.kind === "unknown_error"
  ) {
    logger.warn("social.callback.unknown_code", {
      code: classified.code,
      kind: classified.kind,
      company_id: companyId,
    });
    void getServiceRoleClient()
      .from("platform_events")
      .insert({
        company_id: companyId,
        actor_id: gate.userId,
        event_type: "unknown_oauth_callback",
        entity_type: "oauth_callback",
        entity_id: null,
        payload: { code: classified.code, kind: classified.kind },
      });
    if (isPopup) {
      return popupCloseResponse(req, "error", "unknown-callback-code");
    }
    const target = new URL("/company/social/connections", req.url);
    target.searchParams.set("connect", "error");
    target.searchParams.set("reason", "unknown-callback-code");
    return NextResponse.redirect(target);
  }

  if (classified?.kind === "error") {
    if (isPopup) {
      return popupCloseResponse(req, "error", classified.reason);
    }
    const target = new URL("/company/social/connections", req.url);
    target.searchParams.set("connect", "error");
    target.searchParams.set("reason", classified.reason);
    return NextResponse.redirect(target);
  }

  // cross_tenant_override=1 is set by /connect when the user clicked "I
  // manage both" in the preflight warning modal. Pass it through to the
  // sync so the cross-tenant block is bypassed for this connect.
  const forceCrossTenantOverride =
    url.searchParams.get("cross_tenant_override") === "1";

  const sync = await syncBundlesocialConnections({
    companyId,
    attributeNewToCompanyId: companyId,
    ...(forceCrossTenantOverride ? { forceCrossTenantOverride: true } : {}),
  });

  // BSP analytics: after the sync attributes new connections, kick off
  // a post-history import for each. Idempotent — the partial unique
  // index dedups against the social-account.connected webhook arriving
  // around the same time.
  if (sync.ok && sync.data.inserted > 0) {
    void triggerImportsForRecentConnections(req, companyId);
  }

  // If the user just connected a channel-selection platform (LINKEDIN /
  // FACEBOOK / INSTAGRAM / YOUTUBE / GOOGLE_BUSINESS), the sync inserted
  // the row in 'pending_identity' state and the customer page needs to
  // open the channel-picker modal. We carry the freshly-inserted row's
  // id so the page can target the picker without a separate lookup.
  let needsChannelConnectionId: string | null = null;
  if (
    sync.ok &&
    sync.data.inserted > 0 &&
    classified?.kind === "success" &&
    CHANNEL_SELECTION_PLATFORMS.has(
      classified.platform.toUpperCase() as "LINKEDIN",
    )
  ) {
    needsChannelConnectionId = await findMostRecentlyInsertedConnectionId(
      companyId,
    );
  }

  let connectParam: string;
  let reasonParam: string | undefined;
  // Bug-fix 2026-05-12: when the user re-connected a platform they already
  // have (sync found existing row → updated=1, inserted=0), surface the
  // platform name so the customer page can render an actionable
  // "already connected" banner and highlight the blocking row.
  let attemptedPlatform: string | undefined;
  if (!sync.ok) {
    connectParam = "sync-failed";
    reasonParam = sync.error.code;
  } else if (needsChannelConnectionId) {
    connectParam = "needs_channel";
  } else if (sync.data.inserted > 0) {
    connectParam = "success";
  } else if (
    (sync.data as { cross_tenant_blocked?: number }).cross_tenant_blocked !==
      undefined &&
    (sync.data as { cross_tenant_blocked?: number }).cross_tenant_blocked! > 0
  ) {
    // Cross-tenant identity-leak defence (migration 0122): sync refused
    // every remote account because the platform identity is already
    // owned by another company. Surface a specific banner reason so the
    // UI shows the right copy.
    connectParam = "error";
    reasonParam = "cross-tenant-blocked";
  } else {
    connectParam = "noop";
    // If the user deliberately went through OAuth but landed back with
    // nothing inserted (updated=1 means the account already exists),
    // pass the platform so the UI can show which connection is blocking.
    if (classified?.kind === "success" && sync.data.updated > 0) {
      attemptedPlatform = classified.platform;
    }
  }

  if (isPopup) {
    // Channel picker now opens as an auto-opening modal in the parent
    // window (2026-05-13 take 2). The previous attempt — 302'ing the
    // popup itself to /connect/pick-channel — had fragile UX when the
    // popup's opener relationship broke under cross-origin navigation
    // or popup-blocker policies. Steven explicitly accepted the modal
    // fallback. The popup closes via postMessage, the parent's message
    // handler mounts ChannelPickerModal against connection_id.
    return popupCloseResponse(
      req,
      connectParam,
      reasonParam,
      needsChannelConnectionId ?? undefined,
      attemptedPlatform,
    );
  }

  const target = new URL("/company/social/connections", req.url);
  target.searchParams.set("connect", connectParam);
  if (reasonParam) target.searchParams.set("reason", reasonParam);
  if (connectParam === "success" && sync.ok) {
    target.searchParams.set("count", String(sync.data.inserted));
  }
  if (needsChannelConnectionId) {
    target.searchParams.set("connection_id", needsChannelConnectionId);
  }
  if (attemptedPlatform) {
    target.searchParams.set("attempted_platform", attemptedPlatform);
  }
  return NextResponse.redirect(target);
}

// After a sync inserts a channel-selection-platform row, the customer
// page needs to know WHICH row to open the channel-picker against.
// Look up the most-recently-inserted row for the company; the sync
// just created it seconds ago, so age-sort is unambiguous.
async function findMostRecentlyInsertedConnectionId(
  companyId: string,
): Promise<string | null> {
  const svc = getServiceRoleClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await svc
    .from("social_connections")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "pending_identity")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logger.warn("social.callback.needs_channel_lookup_failed", {
      err: error.message,
      company_id: companyId,
    });
    return null;
  }
  return (data?.[0]?.id as string | undefined) ?? null;
}

// Scans for connections that were just inserted by sync and enqueues a
// post-history import for each. Idempotent — the import-row table's
// partial unique index absorbs duplicate enqueues from the
// social-account.connected webhook arriving in the same second.
//
// "Recent" = created in the last 60 seconds. Wider than necessary to
// tolerate any clock skew between the sync's INSERT and this scan.
async function triggerImportsForRecentConnections(
  req: NextRequest,
  companyId: string,
): Promise<void> {
  const svc = getServiceRoleClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await svc
    .from("social_connections")
    .select("profile_id, bundle_social_account_id, platform")
    .eq("company_id", companyId)
    .gte("created_at", since)
    .not("profile_id", "is", null);
  if (error) {
    logger.warn("social.callback.post_history_import_scan_failed", {
      err: error.message,
      company_id: companyId,
    });
    return;
  }
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? new URL(req.url).origin;
  for (const row of data ?? []) {
    try {
      await enqueuePostHistoryImport({
        profileId: row.profile_id as string,
        bundleSocialAccountId: row.bundle_social_account_id as string,
        platform: row.platform as SocialPlatform,
        origin,
      });
    } catch (err) {
      logger.warn("social.callback.post_history_import_enqueue_failed", {
        err: err instanceof Error ? err.message : String(err),
        bundle_social_account_id: row.bundle_social_account_id,
      });
    }
  }
}
