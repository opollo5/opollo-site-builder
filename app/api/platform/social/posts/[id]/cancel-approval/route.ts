import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { cancelApprovalRequest } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-10 — POST /api/platform/social/posts/[id]/cancel-approval
//
// Atomically revokes the open approval_request, flips the post back
// to draft, and writes a 'revoked' audit event tied to the canceller.
// Migration 0073 wraps the three writes in one Postgres function so
// the invariant "post in draft → no open request, audit event recorded"
// holds even under concurrent cancel attempts.
//
// Gate: canDo("edit_post", company_id) — same threshold as edit/delete.
// The cancellation is an editorial recovery move, not a user-management
// one.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const Schema = z.object({
  company_id: z.string().uuid(),
  reason: z.string().max(2000).nullable().optional(),
});

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, reason?: string }.",
      400,
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await cancelApprovalRequest({
    postId: id,
    companyId: parsed.data.company_id,
    actorUserId: gate.userId,
    reason: parsed.data.reason ?? null,
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
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
