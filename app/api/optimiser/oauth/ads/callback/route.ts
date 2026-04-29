import { NextResponse, type NextRequest } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { logger } from "@/lib/logger";
import { upsertCredential } from "@/lib/optimiser/credentials";
import {
  exchangeCodeForRefreshToken,
  verifyState,
} from "@/lib/optimiser/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["admin", "operator"] });
  if (access.kind === "redirect") {
    return NextResponse.redirect(new URL(access.to, req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User clicked "Cancel" or Google rejected the consent. Bounce back
  // with a soft error.
  if (error || !code || !stateParam) {
    const back = new URL("/optimiser", url.origin);
    back.searchParams.set("error", error ?? "ads_oauth_aborted");
    return NextResponse.redirect(back);
  }

  const state = verifyState(stateParam);
  if (!state || state.source !== "google_ads") {
    logger.warn("optimiser.oauth.ads.invalid_state");
    const back = new URL("/optimiser", url.origin);
    back.searchParams.set("error", "ads_oauth_invalid_state");
    return NextResponse.redirect(back);
  }

  const redirectUri = new URL(
    "/api/optimiser/oauth/ads/callback",
    url.origin,
  ).toString();
  const tokens = await exchangeCodeForRefreshToken({
    code,
    redirectUri,
    source: "google_ads",
  });
  if (!tokens) {
    logger.warn("optimiser.oauth.ads.exchange_failed", {
      client_id: state.opt_client_id,
    });
    const back = new URL(
      `/optimiser/onboarding/${state.opt_client_id}`,
      url.origin,
    );
    back.searchParams.set("error", "ads_oauth_exchange_failed");
    return NextResponse.redirect(back);
  }

  // The Ads customer_id is selected on the next onboarding step (the
  // user picks which Ads customer in their account to connect). Store
  // the refresh token now and let the next step persist customer_id +
  // login_customer_id.
  try {
    await upsertCredential({
      clientId: state.opt_client_id,
      source: "google_ads",
      payload: { refresh_token: tokens.refresh_token, customer_id: "" },
      updatedBy: access.user?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("optimiser.oauth.ads.persist_failed", {
      client_id: state.opt_client_id,
      error: message,
    });
    const back = new URL(
      `/optimiser/onboarding/${state.opt_client_id}`,
      url.origin,
    );
    back.searchParams.set("error", "ads_oauth_persist_failed");
    return NextResponse.redirect(back);
  }

  const back = new URL(
    `/optimiser/onboarding/${state.opt_client_id}`,
    url.origin,
  );
  back.searchParams.set("step", "ads_customer");
  return NextResponse.redirect(back);
}
