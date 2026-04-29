import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { testWpConnection } from "@/lib/site-test-connection";

// AUTH-FOUNDATION P2.1 — POST /api/sites/test-connection.
//
// Pre-save WP credential test. Backs the "Test connection" button on
// /admin/sites/new and /admin/sites/[id]/edit. Hits the operator's WP
// at /wp-json/wp/v2/users/me?context=edit with Basic auth and runs
// the capability check.
//
// Body: { url, username, app_password }
// Returns: { ok: true, user: { display_name, username, roles } }
//        | { ok: false, error: { code, message } }
//
// Admin/operator gated; rate-limited via the test_connection bucket
// (60/hour) so an operator iterating on a wrong app password isn't
// blocked but a scan-style abuse is.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    url: z.string().min(1).max(500),
    username: z.string().min(1).max(100),
    app_password: z.string().min(1).max(200),
  })
  .strict();

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
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
          message: "Body must include url, username, and app_password.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  const result = await testWpConnection(parsed.data);
  // 200 either way — the API succeeded; the WP connection result is
  // in the body. The form differentiates on `ok` not on HTTP status.
  return NextResponse.json(result);
}
