import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { duplicatePost } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-36 — POST /api/platform/social/posts/[id]/duplicate
//
// Creates a new draft post with the same master_text, link_url, and
// variant overrides as the source post. Returns the new post's ID so
// the client can redirect.
//
// Gate: create_post (editor+).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const Schema = z.object({
  company_id: z.string().uuid(),
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
    return errorJson("NOT_FOUND", "Post not found.", 404);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return errorJson("VALIDATION_FAILED", "company_id (UUID) required.", 400);
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const session = await getCurrentPlatformSession();
  if (!session) {
    return errorJson("UNAUTHORIZED", "Authentication required.", 401);
  }

  const result = await duplicatePost({
    postId: id,
    companyId: parsed.data.company_id,
    userId: gate.userId,
  });

  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
