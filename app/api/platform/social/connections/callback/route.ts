import { NextResponse, type NextRequest } from "next/server";

import { enqueuePostHistoryImport } from "@/lib/platform/social/analytics-ingest";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

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
): NextResponse {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;

  const payload = JSON.stringify({
    type: "bundle-connect-complete",
    connect: connectParam,
    ...(reason ? { reason } : {}),
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

  const errorParam = [
    "not-enough-permissions",
    "not-enough-pages",
    "auth-failed",
    "user-cancelled",
  ].find((k) => url.searchParams.has(k));

  let connectParam: string;
  let reasonParam: string | undefined;
  if (errorParam) {
    connectParam = "error";
    reasonParam = errorParam;
  } else if (!sync.ok) {
    connectParam = "sync-failed";
    reasonParam = sync.error.code;
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
  }

  if (isPopup) {
    return popupCloseResponse(req, connectParam, reasonParam);
  }

  const target = new URL("/company/social/connections", req.url);
  target.searchParams.set("connect", connectParam);
  if (reasonParam) target.searchParams.set("reason", reasonParam);
  if (connectParam === "success" && sync.ok) {
    target.searchParams.set("count", String(sync.data.inserted));
  }
  return NextResponse.redirect(target);
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