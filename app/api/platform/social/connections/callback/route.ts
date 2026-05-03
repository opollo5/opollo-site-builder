import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-16 — GET /api/platform/social/connections/callback
//
// bundle.social redirects here after the OAuth dance completes (or
// errors). Query params:
//   company_id           — set by /connect when minting the portal URL
//   <platform>-callback  — bundle.social's success signal (e.g.
//                          twitter-callback=true). We don't act on it
//                          beyond logging; the sync below is the source
//                          of truth.
//   not-enough-permissions / not-enough-pages / etc — error signals.
//
// Behaviour: regardless of success/error params, sync from bundle.social
// to find any newly-attached account and attribute it to company_id.
// Then 302 redirect the admin's browser back to /company/social/
// connections with a success or error toast.
//
// Gate: canDo("manage_connections", company_id). The browser carrying
// the bundle.social redirect IS the admin who started the flow, so the
// session cookie is intact.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    // Send the admin somewhere sensible; the company id was lost in
    // the redirect chain. /company/social/connections requires a
    // session anyway, so they'll land at /login if needed.
    return NextResponse.redirect(
      new URL("/company/social/connections?connect=error", req.url),
    );
  }

  const gate = await requireCanDoForApi(companyId, "manage_connections");
  if (gate.kind === "deny") {
    // 401/403 doesn't make sense as a redirect target for a browser
    // mid-OAuth — surface the gate response directly.
    return gate.response;
  }

  // Sync — attribute any new accounts to this company. The result
  // tells us whether anything changed, but the redirect is the same
  // either way; the admin sees the connections page repaint.
  const sync = await syncBundlesocialConnections({
    attributeNewToCompanyId: companyId,
  });

  // Detect explicit error params from bundle.social and pass them
  // through so the destination page can render a toast.
  const errorParam = [
    "not-enough-permissions",
    "not-enough-pages",
    "auth-failed",
    "user-cancelled",
  ].find((k) => url.searchParams.has(k));

  const target = new URL("/company/social/connections", req.url);
  if (errorParam) {
    target.searchParams.set("connect", "error");
    target.searchParams.set("reason", errorParam);
  } else if (!sync.ok) {
    target.searchParams.set("connect", "sync-failed");
    target.searchParams.set("reason", sync.error.code);
  } else if (sync.data.inserted > 0) {
    target.searchParams.set("connect", "success");
    target.searchParams.set("count", String(sync.data.inserted));
  } else {
    // No new accounts attached. Common when the operator backed out
    // or only refreshed an existing account.
    target.searchParams.set("connect", "noop");
  }

  return NextResponse.redirect(target);
}
