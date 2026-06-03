import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { validate } from "@/lib/platform/magic-link";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/portal/connections/callback
//
// B4 client portal — receives bundle.social OAuth callback after a client
// reconnects their social connection. No Supabase session. portal_token IS
// the auth.
//
// SECURITY — COMPANY BINDING (Requirement #1, hard requirement):
//   company_id is derived SERVER-SIDE from the magic_links row identified by
//   portal_token. The client never supplies company_id. bundle.social never
//   supplies company_id. No URL param from this request is used for binding.
//
// Cross-tenant guard (Requirement #2):
//   checkCrossTenantConflict() runs via the SAME syncBundlesocialConnections()
//   function as the operator path — not reimplemented, not branched around.
//
// Cron carry-forward (from Steven 2026-06-03):
//   On reconnect success, NULL both pre_expiry_7d_sent_at and
//   pre_expiry_1d_sent_at on the connection so the next expiry cycle can
//   send fresh notices.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const portalToken = url.searchParams.get("portal_token");
  const isPopup = url.searchParams.get("popup") === "1";

  // ─── Step 1: validate magic_links session ──────────────────────────────
  if (!portalToken || !/^[0-9a-f]{64}$/i.test(portalToken)) {
    return popupClose(req, "error", "invalid-session");
  }

  const session = await validate(portalToken);
  if (!session.valid) {
    logger.warn("portal.callback.session_invalid", {
      reason: session.reason,
      popup: isPopup,
    });
    return popupClose(req, "error", "session-expired");
  }

  // company_id derived exclusively from magic_links row.
  // No URL parameter, no request body, no cookie contributes to this value.
  const companyId = session.link.company_id;
  if (!companyId) {
    logger.error("portal.callback.no_company_id", { link_id: session.link.id });
    return popupClose(req, "error", "invalid-session");
  }

  // ─── Step 2: classify bundle.social callback params ────────────────────
  // bundle.social posts back with ?success=... or ?error=... params (new
  // format) or ?<platform>-callback=... (old format). Errors mean OAuth
  // never completed — return early without syncing.
  const successParam = url.searchParams.get("success");
  const errorParam   = url.searchParams.get("error");

  if (errorParam) {
    logger.info("portal.callback.oauth_error", { companyId, error: errorParam });
    return popupClose(req, "error", errorParam);
  }

  if (!successParam) {
    // No success or error — check old-format params
    const isOldFormat = Array.from(url.searchParams.keys()).some(
      (k) => k.endsWith("-callback"),
    );
    if (!isOldFormat) {
      // No recognisable OAuth completion signal — close without action.
      logger.warn("portal.callback.no_oauth_signal", { companyId });
      return popupClose(req, "noop");
    }
  }

  // ─── Step 3: sync — SAME function as operator path ─────────────────────
  // syncBundlesocialConnections calls checkCrossTenantConflict() internally
  // on every inserted connection. attributeNewToCompanyId is the server-side
  // derived companyId — never influenced by the client.
  //
  // forceCrossTenantOverride is intentionally omitted — the portal never
  // overrides cross-tenant protection (no "I manage both" flow for clients).
  const sync = await syncBundlesocialConnections({
    companyId,
    attributeNewToCompanyId: companyId,
  });

  if (!sync.ok) {
    logger.error("portal.callback.sync_failed", {
      companyId,
      err: sync.error.message,
      code: sync.error.code,
    });
    return popupClose(req, "error", "sync-failed");
  }

  logger.info("portal.callback.synced", {
    companyId,
    inserted: sync.data.inserted,
    updated: sync.data.updated,
  });

  // ─── Step 4: reset pre_expiry sent-at columns on reconnected connection ─
  // Carry-forward requirement (Steven 2026-06-03): when a connection is
  // successfully reconnected and expires_at is refreshed by the sync, NULL
  // both pre_expiry_*_sent_at columns so the next expiry cycle can send
  // fresh notices. Without this, the cron silently stops after one cycle.
  //
  // We find the most recently-updated healthy connection for this company
  // (the one just reconnected). The sync already set status=healthy.
  if (sync.data.inserted > 0 || sync.data.updated > 0) {
    const svc = getServiceRoleClient();
    const { data: reconnected } = await svc
      .from("social_connections")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "healthy")
      .not("expires_at", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reconnected?.id) {
      const { error: resetErr } = await svc
        .from("social_connections")
        .update({
          pre_expiry_7d_sent_at: null,
          pre_expiry_1d_sent_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reconnected.id)
        .eq("company_id", companyId); // explicit company guard even on update

      if (resetErr) {
        // Non-fatal: log and continue. The cron will re-send notices
        // after the existing timestamps expire regardless.
        logger.warn("portal.callback.reset_sent_at_failed", {
          connectionId: reconnected.id,
          err: resetErr.message,
        });
      } else {
        logger.info("portal.callback.reset_pre_expiry_sent_at", {
          connectionId: reconnected.id,
          companyId,
        });
      }
    }
  }

  // ─── Step 5: return popup close response ───────────────────────────────
  const connectResult = sync.data.inserted > 0
    ? "success"
    : sync.data.updated > 0
      ? "success"
      : "noop";

  return popupClose(req, connectResult);
}

// ---------------------------------------------------------------------------
// popupClose — same pattern as the operator callback.
// Sends HTML that postMessages the result to window.opener and closes.
// ---------------------------------------------------------------------------
function popupClose(
  req: NextRequest,
  connect: string,
  reason?: string,
): NextResponse {
  const origin = req.nextUrl.origin;
  const payload = JSON.stringify({
    type: "bundle-connect-complete",
    connect,
    ...(reason ? { reason } : {}),
  });

  const html = `<!DOCTYPE html>
<html>
<body>
<script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(${payload}, ${JSON.stringify(origin)});
    }
  } catch (e) {}
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
