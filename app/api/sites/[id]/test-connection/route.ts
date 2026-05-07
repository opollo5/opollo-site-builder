import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { recordTestConnectionSuccess, testSiteConnection } from "@/lib/sites";

// Spec 01 §3.1 — POST /api/sites/[id]/test-connection.
//
// Drives the "Test Connection" item in the per-row dropdown menu on
// /admin/sites. Operator clicks → spinner → success/error toast.
//
// Distinct from POST /api/sites/test-connection (the rich preflight
// route that backs /admin/sites/new and /admin/sites/[id]/edit's
// "Test connection" button). That route returns full WP user info
// for inline display; this one returns a minimal {ok, errorCode}
// envelope sized for the toast.
//
// Both routes go through testWpConnection() under the hood — the
// shared transport call lives in lib/site-test-connection.ts. This
// route additionally goes through testSiteConnection() in lib/sites.ts
// which owns the 8s timeout, the credential-lookup branch, and the
// stored-creds-only invariant for site-id-keyed tests.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Site id must be a UUID.",
        },
      },
      { status: 400 },
    );
  }

  // Re-use the test-connection rate-limit bucket so an operator clicking
  // through dropdown actions across many sites can't outpace the
  // explicit-credentials test path.
  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("test_connection", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  const result = await testSiteConnection(params.id);
  if (result.ok) {
    await recordTestConnectionSuccess(params.id);
    return NextResponse.json({ ok: true });
  }

  logger.info("sites.test_connection.row_action_failed", {
    site_id: params.id,
    error_code: result.errorCode,
  });
  return NextResponse.json({ ok: false, errorCode: result.errorCode });
}
