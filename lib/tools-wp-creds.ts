import "server-only";

import { NextResponse } from "next/server";

import { getSite } from "@/lib/sites";
import type { WpCredentialsOverride } from "@/lib/wordpress";

// Shared helper used by the tools/* route handlers to seed
// runWithWpCredentials() context when the caller passes a site_id in the
// request body. When site_id is omitted, creds is undefined and readWpConfig()
// inside the executor falls back to LEADSOURCE_* env vars (single-site
// compatibility).
//
// Returns { ok: true, creds } on success, or { ok: false, response } when the
// site is not found or has no credentials — callers should return response
// immediately.

export async function resolveToolWpCreds(
  siteId: string | undefined,
): Promise<
  | { ok: true; creds: WpCredentialsOverride | undefined }
  | { ok: false; response: NextResponse }
> {
  if (!siteId) return { ok: true, creds: undefined };

  const siteResult = await getSite(siteId, { includeCredentials: true });
  if (!siteResult.ok) {
    const status = siteResult.error.code === "NOT_FOUND" ? 404 : 500;
    return { ok: false, response: NextResponse.json(siteResult, { status }) };
  }

  const { site, credentials } = siteResult.data;
  if (!credentials) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: `Site ${siteId} has no credentials.`,
            retryable: false,
            suggested_action:
              "Re-register the site or restore the site_credentials row.",
          },
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      ),
    };
  }

  return {
    ok: true,
    creds: {
      wp_url: site.wp_url,
      wp_user: credentials.wp_user,
      wp_app_password: credentials.wp_app_password,
    },
  };
}
