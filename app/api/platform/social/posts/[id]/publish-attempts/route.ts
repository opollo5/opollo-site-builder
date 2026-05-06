import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { listPublishAttempts } from "@/lib/platform/social/publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query param required.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listPublishAttempts({ postMasterId: id, companyId });
  if (!result.ok) return internalError(result.error.message);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
