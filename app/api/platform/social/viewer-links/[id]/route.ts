import { NextResponse, type NextRequest } from "next/server";

import { respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { revokeViewerLink } from "@/lib/platform/social/viewer-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await revokeViewerLink({ linkId: id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { link: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
