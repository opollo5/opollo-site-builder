import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { conflict, internalError, notFound, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { revokeInvitation } from "@/lib/platform/invitations";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DELETE /api/platform/invitations/[id] — P2-2.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().uuid();

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idParse = IdSchema.safeParse(params.id);
  if (!idParse.success) return validationError("Invitation id must be a UUID.");
  const invitationId = idParse.data;

  const svc = getServiceRoleClient();
  const lookup = await svc
    .from("platform_invitations")
    .select("company_id")
    .eq("id", invitationId)
    .maybeSingle();
  if (lookup.error) {
    logger.error("platform.invitations.revoke.pre_lookup_failed", { err: lookup.error.message });
    return internalError("Lookup failed.");
  }
  if (!lookup.data) return notFound("No invitation with that id.");

  const gate = await requireCanDoForApi(lookup.data.company_id as string, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await revokeInvitation(invitationId, gate.userId);

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "NOT_FOUND") return notFound(message);
    if (code === "ALREADY_ACCEPTED" || code === "ALREADY_REVOKED") return conflict(code, message);
    return internalError(message);
  }

  return NextResponse.json(
    { ok: true, data: { invitation: result.invitation }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
