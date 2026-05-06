import { NextResponse, type NextRequest } from "next/server";

import { respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { cancelScheduleEntry } from "@/lib/platform/social/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entry_id: string }> },
): Promise<NextResponse> {
  const { id, entry_id } = await params;
  if (!UUID_RE.test(id)) return validationError("post id must be a UUID.");
  if (!UUID_RE.test(entry_id)) return validationError("entry_id must be a UUID.");
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  const result = await cancelScheduleEntry({ entryId: entry_id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { entry: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
