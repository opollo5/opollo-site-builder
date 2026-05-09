import "server-only";

import { ApiError } from "bundlesocial";

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

  const requestPayload = {
    teamId,
    redirectUrl: input.redirectUrl,
    socialAccountTypes: bundlePlatforms,
    userName: input.userName ?? undefined,
    userLogoUrl: input.userLogoUrl ?? undefined,
  };

  logger.info("bundlesocial.initiate_connect.request", {
    company_id: input.companyId,
    team_id_prefix: teamId.slice(0, 8),
    redirect_url: input.redirectUrl,
    social_account_types: bundlePlatforms,
  });

  try {
    const response = await client.socialAccount.socialAccountCreatePortalLink({
      requestBody: requestPayload,
    });

    logger.info("bundlesocial.initiate_connect.response", {
      company_id: input.companyId,
      response_url: response?.url ?? null,
      response_keys: response ? Object.keys(response) : [],
      has_url: Boolean(response?.url),
    });

    if (!response?.url) {
      return internal("bundle.social returned no portal URL.");
    }

    // Validate the returned URL. A bare https://bundle.social/connect with no
    // query params means bundle.social did not embed a session token — the user
    // would see "There was an error" on that page. Hard-fail here rather than
    // redirecting to a broken page, and log the full URL so we can diagnose.
    let parsedUrl: URL | null = null;
    try { parsedUrl = new URL(response.url); } catch { /* logged below */ }

    if (!parsedUrl || parsedUrl.protocol !== "https:") {
      logger.error("bundlesocial.initiate_connect.invalid_url", {
        company_id: input.companyId,
        url: response.url,
        reason: "not a valid https URL",
      });
      return internal(`bundle.social returned an invalid portal URL: ${response.url}`);
    }

    if (!parsedUrl.search) {
      // No query params means no token. Most likely causes:
      //   1. redirectUrl domain is not whitelisted in bundle.social's team settings.
      //   2. teamId does not match the API key's team.
      // Check: bundle.social dashboard → Team → Settings → Allowed redirect domains.
      logger.error("bundlesocial.initiate_connect.url_missing_token", {
        company_id: input.companyId,
        url: response.url,
        redirect_url_sent: input.redirectUrl,
        team_id_prefix: teamId.slice(0, 8),
        reason: "portal URL has no query params — token not embedded by bundle.social",
      });
      return internal(
        "bundle.social returned a portal URL without a session token. " +
        "The redirect URL is probably not whitelisted in the bundle.social team settings. " +
        `Redirect URL sent: ${input.redirectUrl}`,
      );
    }

    return {
      ok: true,
      data: { url: response.url },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof ApiError) {
      logger.error("bundlesocial.initiate_connect.api_error", {
        company_id: input.companyId,
        status: err.status,
        status_text: err.statusText,
        body: err.body,
        request_url: err.request?.url,
        message: err.message,
      });
      return internal(
        `bundle.social create-portal-link failed: HTTP ${err.status} ${err.statusText} — ${JSON.stringify(err.body)}`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause ? String(err.cause) : undefined;
    logger.error("bundlesocial.initiate_connect.failed", {
      company_id: input.companyId,
      err: message,
      cause,
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
