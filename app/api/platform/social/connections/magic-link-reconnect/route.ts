import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { issue } from "@/lib/platform/magic-link";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/magic-link-reconnect
//
// Issues a magic link for reconnecting a specific social connection.
// Gate: editor+ (mirrors the interactive reconnect route permission).
// Returns { ok: true, magicLinkUrl } — caller embeds this in a notification
// or displays a "reconnect" button.
//
// The consumption route at /magic-link/reconnect validates + consumes the
// link and redirects to the OAuth reconnect start for the connection.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  company_id: z.string().uuid(),
  connection_id: z.string().uuid(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req);
  const rl = await checkRateLimit("magic-link-reconnect", ip);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const { company_id, connection_id } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "reconnect_connection");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  // Verify the connection belongs to this company and needs reconnect
  const { data: connection, error: connErr } = await svc
    .from("social_connections")
    .select("id, status, company_id")
    .eq("id", connection_id)
    .eq("company_id", company_id)
    .maybeSingle();

  if (connErr || !connection) {
    return validationError("Connection not found in this company.");
  }
  if (
    connection.status !== "auth_required" &&
    connection.status !== "disconnected"
  ) {
    return validationError(
      "Connection does not require reconnect (status: " + connection.status + ").",
    );
  }

  let rawToken: string;
  try {
    const result = await issue({
      purpose: "reconnect",
      subjectType: "social_connection",
      subjectId: connection_id,
      companyId: company_id,
    });
    rawToken = result.rawToken;
  } catch (err) {
    logger.error("magic_link.reconnect.issue_failed", { err: String(err) });
    return internalError("Failed to issue reconnect link.");
  }

  const magicLinkUrl = `${req.nextUrl.origin}/magic-link/reconnect?token=${rawToken}`;

  return NextResponse.json(
    { ok: true, data: { magicLinkUrl }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
