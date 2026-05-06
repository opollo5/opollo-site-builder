import { NextResponse, type NextRequest } from "next/server";

import { respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { revokeRecipient } from "@/lib/platform/social/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recipient_id: string }> },
): Promise<NextResponse> {
  const { id, recipient_id } = await params;
  if (!UUID_RE.test(id)) return validationError("post id must be a UUID.");
  if (!UUID_RE.test(recipient_id)) return validationError("recipient_id must be a UUID.");
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "submit_for_approval");
  if (gate.kind === "deny") return gate.response;

  const result = await revokeRecipient({ recipientId: recipient_id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { recipient: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
