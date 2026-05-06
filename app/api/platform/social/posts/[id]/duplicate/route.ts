import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody, validationError, notFound, internalError, routeError } from "@/lib/http";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return notFound("Post not found.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("company_id (UUID) required.");
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const session = await getCurrentPlatformSession();
  if (!session) {
    return routeError("UNAUTHORIZED", "Authentication required.");
  }

  const result = await duplicatePost({
    postId: id,
    companyId: parsed.data.company_id,
    userId: gate.userId,
  });

  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    if (result.error.code === "NOT_FOUND") return notFound(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
