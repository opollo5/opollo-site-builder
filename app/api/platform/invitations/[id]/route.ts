import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { revokeInvitation } from "@/lib/platform/invitations";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DELETE /api/platform/invitations/[id] — P2-2.
//
// Revokes a pending invitation. Caller must have manage_invitations in
// the invitation's company (admin role or Opollo staff). Returns the
// updated invitation row on success.
//
// The gate runs AFTER an unauthenticated lookup of company_id from the
// invitation row — that lookup leaks the existence of the id but not
// the company affiliation (any caller can probe a uuid; the response
// shape on 404 vs 403 is otherwise identical, no information disclosure).
//
// Errors:
//   400 VALIDATION_FAILED — id is not a uuid.
//   401 UNAUTHORIZED      — no session.
//   403 FORBIDDEN         — caller lacks manage_invitations in the
//                           invitation's company.
//   404 NOT_FOUND         — no invitation with that id.
//   409 ALREADY_ACCEPTED  — invitation was already accepted; revoke the
//                           user via user management instead.
//   409 ALREADY_REVOKED   — invitation was already revoked.
//   500 INTERNAL_ERROR    — DB failure.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IdSchema = z.string().uuid();

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idParse = IdSchema.safeParse(params.id);
  if (!idParse.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Invitation id must be a UUID.",
      400,
    );
  }
  const invitationId = idParse.data;

  // Pre-lookup to discover company_id so the gate can evaluate.
  const svc = getServiceRoleClient();
  const lookup = await svc
    .from("platform_invitations")
    .select("company_id")
    .eq("id", invitationId)
    .maybeSingle();
  if (lookup.error) {
    logger.error("platform.invitations.revoke.pre_lookup_failed", {
      err: lookup.error.message,
    });
    return errorJson("INTERNAL_ERROR", "Lookup failed.", 500);
  }
  if (!lookup.data) {
    return errorJson("NOT_FOUND", "No invitation with that id.", 404);
  }

  const gate = await requireCanDoForApi(
    lookup.data.company_id as string,
    "manage_invitations",
  );
  if (gate.kind === "deny") return gate.response;

  const result = await revokeInvitation(invitationId, gate.userId);

  if (!result.ok) {
    const code = result.error.code;
    const status =
      code === "NOT_FOUND"
        ? 404
        : code === "ALREADY_ACCEPTED" || code === "ALREADY_REVOKED"
          ? 409
          : 500;
    return errorJson(code, result.error.message, status);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { invitation: result.invitation },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
