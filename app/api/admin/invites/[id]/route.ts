import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { revokeInvite } from "@/lib/invites";

// AUTH-FOUNDATION P3.2 — DELETE /api/admin/invites/[id].
//
// Marks a pending invite revoked + writes the matching audit row in
// one transaction (via the revoke_invite Postgres function).
//
// Both super_admin and admin can revoke (the row's existence in
// pending state is the operative signal; preventing role escalation
// happens at create-time, not revoke-time).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invite id must be a UUID." },
      },
      { status: 400 },
    );
  }

  const result = await revokeInvite({
    inviteId: params.id,
    actorId: gate.user?.id ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 500 },
    );
  }
  if (!result.revoked) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "STATUS_CONFLICT",
          message: "Invite is no longer pending — already accepted, revoked, or expired.",
        },
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, data: { revoked: true } });
}
