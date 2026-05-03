import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { listPublishAttempts } from "@/lib/platform/social/publishing";

// ---------------------------------------------------------------------------
// S1-21 — GET /api/platform/social/posts/[id]/publish-attempts
//
// Returns the publish_attempts history for a single post. Drives the
// PostPublishHistorySection on the post detail page.
//
// Gate: canDo("view_calendar", company_id) — viewer+. Operators with
// "schedule_post" are the ones who can press Retry, but anyone with
// view_calendar can SEE the history.
//
// Query: ?company_id=<uuid>
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson("VALIDATION_FAILED", "company_id query param required.", 400);
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listPublishAttempts({
    postMasterId: id,
    companyId,
  });
  if (!result.ok) {
    return errorJson(result.error.code, result.error.message, 500);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
