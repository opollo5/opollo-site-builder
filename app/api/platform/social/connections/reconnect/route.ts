import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/reconnect — S8 self-service reconnect.
//
// Lowers the permission bar for reconnecting an *existing* disconnected or
// auth_required social connection from admin-only (manage_connections) to
// editor+ (reconnect_connection). Creating new connections, deleting, and
// syncing remain admin-only via the /connect and /sync routes.
//
// Body: { company_id: uuid, connection_id: uuid }
//
// Flow:
//   1. Gate: reconnect_connection (editor+).
//   2. Validate: connection exists for this company AND is reconnectable
//      (status = auth_required | disconnected). Returns 409 otherwise
//      so the client can tell the user "that connection is healthy, no
//      action needed" vs a generic error.
//   3. Call initiateBundlesocialConnect with the connection's platform.
//   4. Return { url } — caller redirects browser there for OAuth.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  company_id: z.string().uuid(),
  connection_id: z.string().uuid(),
});

const RECONNECTABLE_STATUSES = ["auth_required", "disconnected"] as const;

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, connection_id: uuid }.",
      400,
    );
  }

  const { company_id: companyId, connection_id: connectionId } = parsed.data;

  // Auth gate — editor+ for reconnect, not manage_connections (admin).
  const gate = await requireCanDoForApi(companyId, "reconnect_connection");
  if (gate.kind === "deny") return gate.response;

  // Validate connection belongs to this company and is in a reconnectable
  // state. Service role bypasses RLS — the auth gate above already confirmed
  // the caller is a member of this company.
  const svc = getServiceRoleClient();
  const { data: conn, error: connErr } = await svc
    .from("social_connections")
    .select("id, company_id, platform, status")
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .single();

  if (connErr || !conn) {
    return errorJson(
      "NOT_FOUND",
      "Connection not found or does not belong to this company.",
      404,
    );
  }

  const status = conn.status as string;
  if (
    !RECONNECTABLE_STATUSES.includes(
      status as (typeof RECONNECTABLE_STATUSES)[number],
    )
  ) {
    return errorJson(
      "CONFLICT",
      `Connection is currently "${status}" and does not need reconnecting.`,
      409,
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const redirectUrl = `${origin}/api/platform/social/connections/callback?company_id=${encodeURIComponent(companyId)}`;

  logger.info("social.connections.reconnect.start", {
    companyId,
    connectionId,
    platform: conn.platform,
    userId: gate.userId,
  });

  const result = await initiateBundlesocialConnect({
    companyId,
    platforms: [conn.platform],
    redirectUrl,
  });

  if (!result.ok) {
    const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
    return errorJson(result.error.code, result.error.message, statusCode);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { url: result.data.url },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
