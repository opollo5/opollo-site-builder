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

  if (error || !code || !stateParam) {
    const back = new URL("/optimiser", url.origin);
    back.searchParams.set("error", error ?? "ga4_oauth_aborted");
    return NextResponse.redirect(back);
  }

  const state = verifyState(stateParam);
  if (!state || state.source !== "ga4") {
    logger.warn("optimiser.oauth.ga4.invalid_state");
    const back = new URL("/optimiser", url.origin);
    back.searchParams.set("error", "ga4_oauth_invalid_state");
    return NextResponse.redirect(back);
  }

  const redirectUri = new URL(
    "/api/optimiser/oauth/ga4/callback",
    url.origin,
  ).toString();
  const tokens = await exchangeCodeForRefreshToken({
    code,
    redirectUri,
    source: "ga4",
  });
  if (!tokens) {
    const back = new URL(
      `/optimiser/onboarding/${state.opt_client_id}`,
      url.origin,
    );
    back.searchParams.set("error", "ga4_oauth_exchange_failed");
    return NextResponse.redirect(back);
  }

  try {
    await upsertCredential({
      clientId: state.opt_client_id,
      source: "ga4",
      payload: { refresh_token: tokens.refresh_token, property_id: "" },
      updatedBy: access.user?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("optimiser.oauth.ga4.persist_failed", {
      client_id: state.opt_client_id,
      error: message,
    });
    const back = new URL(
      `/optimiser/onboarding/${state.opt_client_id}`,
      url.origin,
    );
    back.searchParams.set("error", "ga4_oauth_persist_failed");
    return NextResponse.redirect(back);
  }

  const back = new URL(
    `/optimiser/onboarding/${state.opt_client_id}`,
    url.origin,
  );
  back.searchParams.set("step", "ga4_property");
  return NextResponse.redirect(back);
}
