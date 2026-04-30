import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { testWpConnection } from "@/lib/site-test-connection";
import { getSite } from "@/lib/sites";

// AUTH-FOUNDATION P2.1 + P2.3 — POST /api/sites/test-connection.
//
// Pre-save WP credential test. Backs the "Test connection" button on
// /admin/sites/new and /admin/sites/[id]/edit. Hits the operator's WP
// at /wp-json/wp/v2/users/me?context=edit with Basic auth and runs
// the capability check.
//
// Two body shapes (P2.3 added the second):
//   1. { url, username, app_password }
//      Tests the explicit credentials. Used by /admin/sites/new and by
//      /admin/sites/[id]/edit when the operator typed a new password.
//   2. { site_id }
//      Tests the credentials stored for site_id. Used by the edit form
//      when the operator clicks Test without typing a new password
//      ("re-test stored creds").
//
// Returns: { ok: true, user: { display_name, username, roles } }
//        | { ok: false, error: { code, message } }
//
// Admin/operator gated; rate-limited via the test_connection bucket
// (60/hour) so an operator iterating on a wrong app password isn't
// blocked but a scan-style abuse is.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ExplicitSchema = z.object({
  url: z.string().min(1).max(500),
  username: z.string().min(1).max(100),
  app_password: z.string().min(1).max(200),
});

const StoredSchema = z.object({
  site_id: z.string().uuid(),
});

const BodySchema = z.union([ExplicitSchema, StoredSchema]);

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("test_connection", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must include either { url, username, app_password } or { site_id }.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  let testInput: { url: string; username: string; app_password: string };

  if ("site_id" in parsed.data) {
    const siteResult = await getSite(parsed.data.site_id, {
      includeCredentials: true,
    });
    if (!siteResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: siteResult.error.code,
            message: siteResult.error.message,
          },
        },
        { status: siteResult.error.code === "NOT_FOUND" ? 404 : 500 },
      );
    }
    const creds = siteResult.data.credentials;
    if (!creds) {
      return NextResponse.json({
        ok: false,
        error: {
          code: "WP_ERROR",
          message:
            "This site has no stored credentials. Provide a username + Application Password to test.",
        },
      });
    }
    testInput = {
      url: siteResult.data.site.wp_url,
      username: creds.wp_user,
      app_password: creds.wp_app_password,
    };
  } else {
    testInput = parsed.data;
  }

  const result = await testWpConnection(testInput);
  // 200 either way — the API succeeded; the WP connection result is
  // in the body. The form differentiates on `ok` not on HTTP status.
  return NextResponse.json(result);
}
