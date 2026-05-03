import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { revokeViewerLink } from "@/lib/platform/social/viewer-links";

// ---------------------------------------------------------------------------
// S1-15 — DELETE /api/platform/social/viewer-links/[id]
//
// Soft-revoke. Atomic UPDATE WHERE revoked_at IS NULL converges
// concurrent revokes. Gate: canDo("manage_invitations").
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

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

function statusForCode(code: string): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "INVALID_STATE":
      return 409;
    default:
      return 500;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "manage_invitations");
  if (gate.kind === "deny") return gate.response;

  const result = await revokeViewerLink({ linkId: id, companyId });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { link: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
