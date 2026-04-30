import { NextResponse, type NextRequest } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { adsConsentUrl, signState } from "@/lib/optimiser/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.redirect(new URL(access.to, req.url));
  }

  const url = new URL(req.url);
  const optClientId = url.searchParams.get("client_id");
  if (!optClientId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_REQUEST", message: "client_id is required" },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const redirectUri = new URL(
    "/api/optimiser/oauth/ads/callback",
    url.origin,
  ).toString();
  const state = signState({ opt_client_id: optClientId, source: "google_ads" });
  const consentUrl = adsConsentUrl({ redirectUri, state });
  if (!consentUrl) {
    // Env not provisioned — surface a soft error rather than a redirect
    // loop. Onboarding UI shows the §7.3 banner pattern.
    const back = new URL(`/optimiser/onboarding/${optClientId}`, url.origin);
    back.searchParams.set("error", "ads_oauth_not_configured");
    return NextResponse.redirect(back);
  }
  return NextResponse.redirect(consentUrl);
}
