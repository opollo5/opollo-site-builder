import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, validationError, notFound, invalidState, internalError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getActiveBrandProfile } from "@/lib/platform/brand/get";
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { company_id: uuid, connection_id: uuid }.");
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
    return notFound("Connection not found or does not belong to this company.");
  }

  const status = conn.status as string;
  if (
    !RECONNECTABLE_STATUSES.includes(
      status as (typeof RECONNECTABLE_STATUSES)[number],
    )
  ) {
    return invalidState(`Connection is currently "${status}" and does not need reconnecting.`);
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;
  const redirectUrl =
    `${origin}/api/platform/social/connections/callback` +
    `?company_id=${encodeURIComponent(companyId)}&popup=1`;

  logger.info("social.connections.reconnect.start", {
    companyId,
    connectionId,
    platform: conn.platform,
    userId: gate.userId,
  });

  const [brand, companyRow] = await Promise.all([
    getActiveBrandProfile(companyId),
    svc
      .from("platform_companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()
      .then((r) => r.data),
  ]);

  const result = await initiateBundlesocialConnect({
    companyId,
    platforms: [conn.platform],
    redirectUrl,
    logoUrl: brand?.logo_primary_url ?? brand?.logo_icon_url ?? undefined,
    userName: companyRow?.name ?? undefined,
    // TODO: set hidePoweredBy: true once companies have a paid-plan flag.
    language: "en",
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    return internalError(result.error.message);
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
