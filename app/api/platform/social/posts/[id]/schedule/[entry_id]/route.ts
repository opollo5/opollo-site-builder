import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { cancelScheduleEntry } from "@/lib/platform/social/scheduling";

// ---------------------------------------------------------------------------
// S1-14 — DELETE /api/platform/social/posts/[id]/schedule/[entry_id]
//
// Soft-cancel a schedule entry. Atomic UPDATE WHERE cancelled_at IS NULL
// ensures concurrent cancels converge.
//
// Gate: canDo("schedule_post", company_id) — same threshold as create.
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
  { params }: { params: Promise<{ id: string; entry_id: string }> },
): Promise<NextResponse> {
  const { id, entry_id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "post id must be a UUID.", 400);
  }
  if (!UUID_RE.test(entry_id)) {
    return errorJson("VALIDATION_FAILED", "entry_id must be a UUID.", 400);
  }
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  const result = await cancelScheduleEntry({
    entryId: entry_id,
    companyId,
  });
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
      data: { entry: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
