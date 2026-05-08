import "server-only";

import {
  getBundlesocialClient,
  getBundlesocialTeamId,
} from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { SocialPlatform } from "./types";

// ---------------------------------------------------------------------------
// S1-16 — initiate a bundle.social hosted connect-portal flow.
//
// We call bundle.social's create-portal-link endpoint with our team
// id, the platforms the operator wants to connect, and a redirect URL
// pointing back at our callback handler. Bundle.social returns a URL;
// we hand that back to the admin's browser, which navigates to it for
// OAuth. After the user finishes the flow, bundle.social redirects to
// our callback with success/error params; the callback handler syncs
// the new accounts back into social_connections.
//
// Mapping platforms (our enum → bundle.social enum):
//   linkedin_personal / linkedin_company → LINKEDIN
//     bundle.social treats personal vs company as channel selection
//     after OAuth; we capture both in our DB but the portal request
//     is the same.
//   facebook_page → FACEBOOK
//   x → TWITTER
//   gbp → GOOGLE_BUSINESS
//
// Caller is responsible for canDo("manage_connections", company_id).
// ---------------------------------------------------------------------------

const PLATFORM_TO_BUNDLE: Record<
  SocialPlatform,
  | "LINKEDIN"
  | "FACEBOOK"
  | "TWITTER"
  | "GOOGLE_BUSINESS"
> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export type InitiateConnectInput = {
  companyId: string;
  // Platforms the admin wants to connect. Empty array = "let the
  // operator pick on the portal page" (bundle.social shows all
  // configured types).
  platforms: SocialPlatform[];
  // Absolute URL the admin's browser should be sent to AFTER bundle.
  // social finishes the OAuth dance. Typically:
  //   `${origin}/api/platform/social/connections/callback?company_id=<id>`
  redirectUrl: string;
  // Branding overrides that surface in the bundle.social portal UI.
  // Optional; defaults shown in their dashboard otherwise.
  userName?: string | null;
  userLogoUrl?: string | null;
};

export type InitiateConnectResult = {
  url: string;
};

export async function initiateBundlesocialConnect(
  input: InitiateConnectInput,
): Promise<ApiResponse<InitiateConnectResult>> {
  if (!input.companyId) return validation("Company id is required.");
  if (!input.redirectUrl) return validation("redirect_url is required.");
  for (const p of input.platforms) {
    if (!(p in PLATFORM_TO_BUNDLE)) {
      return validation(`Unsupported platform: ${p}.`);
    }
  }

  const client = getBundlesocialClient();
  if (!client) return notConfigured("BUNDLE_SOCIAL_API");
  const teamId = getBundlesocialTeamId();
  if (!teamId) return notConfigured("BUNDLE_SOCIAL_TEAMID");

  const rawPlatforms: Array<
    "LINKEDIN" | "FACEBOOK" | "TWITTER" | "GOOGLE_BUSINESS"
  > =
    input.platforms.length > 0
      ? input.platforms.map((p) => PLATFORM_TO_BUNDLE[p])
      : (Object.values(PLATFORM_TO_BUNDLE) as Array<
          "LINKEDIN" | "FACEBOOK" | "TWITTER" | "GOOGLE_BUSINESS"
        >);
  // De-dupe once; covers both paths (linkedin_personal + linkedin_company
  // both map to LINKEDIN; the fallback Object.values produces the same
  // duplicate before Set collapses it).
  const bundlePlatforms = Array.from(new Set(rawPlatforms));

  // PROBE: force single-platform to isolate whether socialAccountTypes is
  // causing the tokenless-URL response. Remove after diagnosis.
  const probePlatforms: ["LINKEDIN"] = ["LINKEDIN"];

  try {
    const response = await client.socialAccount.socialAccountCreatePortalLink({
      requestBody: {
        teamId,
        redirectUrl: input.redirectUrl,
        socialAccountTypes: probePlatforms,
        userName: input.userName ?? undefined,
        userLogoUrl: input.userLogoUrl ?? undefined,
      },
    });
    if (!response?.url) {
      return internal("bundle.social returned no portal URL.");
    }
    return {
      ok: true,
      data: { url: response.url },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.initiate_connect.failed", {
      err: message,
      company_id: input.companyId,
    });
    return internal(`bundle.social create-portal-link failed: ${message}`);
  }
}

function validation(message: string): ApiResponse<InitiateConnectResult> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notConfigured(envVar: string): ApiResponse<InitiateConnectResult> {
  logger.error("social.connections.initiate_connect.not_configured", { env_var: envVar });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `${envVar} is not configured. Set it in Vercel + .env.local.`,
      retryable: false,
      suggested_action:
        "Provision the env var, then re-deploy / restart the dev server.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<InitiateConnectResult> {
  logger.error("social.connections.initiate_connect.internal_error", { message });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
