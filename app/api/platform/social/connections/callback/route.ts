import { NextResponse, type NextRequest } from "next/server";

import { enqueuePostHistoryImport } from "@/lib/platform/social/analytics-ingest";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { CHANNEL_SELECTION_PLATFORMS } from "@/lib/platform/social/connections/identity";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// Per the bundle.social docs at
// https://info.bundle.social/api-reference/connect-social-accounts,
// every per-platform OAuth redirect lands with a `<platform>-callback=`
// query param (either `true` for success or `error` for generic OAuth
// failure), plus optional platform-specific error params.
//
// The set below is normalised to lowercase bundle.social platform
// names; `find` against this set rather than the hand-rolled four-
// generic-string list that used to live here. New platforms only need
// adding to the PLATFORM_KEYS list below — error-handling stays generic.
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

// Error-suffix → reason code mapping. Reason codes are the values
// surfaced via ?reason= to /company/social/connections, where
// REASON_LABEL maps them to copy.
const ERROR_SUFFIXES: Array<{ suffix: string; reason: string }> = [
  { suffix: "-not-enough-channels", reason: "not-enough-channels" },
  { suffix: "-not-enough-permissions", reason: "not-enough-permissions" },
  { suffix: "-not-enough-pages", reason: "not-enough-pages" },
  { suffix: "-not-enough-accounts", reason: "not-enough-accounts" },
  { suffix: "-not-enough-servers", reason: "not-enough-servers" },
  { suffix: "-not-enough-workspaces", reason: "not-enough-workspaces" },
];

// Scan the URL for the first platform-prefixed signal and classify.
// Returns `null` when nothing matches — the caller falls through to
// the sync-driven outcome.
function classifyPlatformParams(
  url: URL,
):
  | { kind: "success"; platform: PlatformKey }
  | { kind: "error"; platform: PlatformKey; reason: string }
  | null {
  // Pre-existing generic keys (legacy bundle.social paths and our own
  // ad-hoc signals from PR #868). Treated as error with the suffix as
  // the reason code.
  for (const key of [
    "not-enough-permissions",
    "not-enough-pages",
    "auth-failed",
    "user-cancelled",
  ]) {
    if (url.searchParams.has(key)) {
      // Use 'unknown' as a synthetic platform — the customer-facing
      // banner only renders the reason copy, not the platform.
      return { kind: "error", platform: "linkedin", reason: key };
    }
  }
  // Platform-prefixed signals.
  for (const platform of PLATFORM_KEYS) {
    // <platform>-callback=true|error
    const cb = url.searchParams.get(`${platform}-callback`);
    if (cb !== null) {
      if (cb === "error") {
        return { kind: "error", platform, reason: "auth-failed" };
      }
      // 'true' or anything else non-error → success signal. Note: we
      // still rely on the sync to do the actual DB insert; this branch
      // only suppresses the noop fall-through.
      return { kind: "success", platform };
    }
    // Platform-specific error suffixes.
    for (const { suffix, reason } of ERROR_SUFFIXES) {
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
//   company_id           — set by /connect when minting the portal URL
//   popup=1              — present when the flow ran in a popup window;
//                          triggers postMessage + window.close() instead
//                          of a full-page redirect.
//   <platform>-callback  — bundle.social's success signal (e.g.
//                          twitter-callback=true). We don't act on it
//                          beyond logging; the sync below is the source
//                          of truth.
//   not-enough-permissions / not-enough-pages / etc — error signals.
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

  // Classify URL params BEFORE running the sync — bundle.social's
  // error signals like <platform>-not-enough-channels mean OAuth never
  // completed (no account created), so the sync would just no-op and
  // produce a misleading "noop" banner. Surface the error directly.
  const classified = classifyPlatformParams(url);
  if (classified && classified.kind === "error") {
    if (isPopup) {
      return popupCloseResponse(req, "error", classified.reason);
    }
    const target = new URL("/company/social/connections", req.url);
    target.searchParams.set("connect", "error");
    target.searchParams.set("reason", classified.reason);
    return NextResponse.redirect(target);
  }

  const sync = await syncBundlesocialConnections({
    companyId,
    attributeNewToCompanyId: companyId,
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