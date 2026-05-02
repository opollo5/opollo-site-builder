import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  deletePostMaster,
  getPostMaster,
  updatePostMaster,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-3 — single-post endpoints.
//
//   GET    /api/platform/social/posts/[id]?company_id=...
//          canDo("view_calendar", company_id) (viewer+).
//   PATCH  /api/platform/social/posts/[id]
//          Body { company_id, master_text?, link_url? }
//          canDo("edit_post", company_id) (editor+). Lib enforces
//          state='draft' guard.
//   DELETE /api/platform/social/posts/[id]?company_id=...
//          canDo("edit_post", company_id) (editor+). Hard delete only
//          while state='draft'; non-drafts return INVALID_STATE.
//
// company_id MUST be supplied on every request — this lets requireCanDoForApi
// gate against the right scope before the lib runs. (Deriving it from
// the post id would mean the unauthorised caller leaks "this id exists in
// some company you can't see" via a 403 vs 404 difference.)
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PatchSchema = z.object({
  company_id: z.string().uuid(),
  master_text: z.string().max(10_000).nullable().optional(),
  link_url: z.string().max(2048).nullable().optional(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        ...(details ? { details } : {}),
      },
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

// Resolve company_id from the query (GET / DELETE) or body (PATCH).
// Returns null if missing/invalid.
function readCompanyIdFromQuery(req: NextRequest): string | null {
  const v = new URL(req.url).searchParams.get("company_id");
  if (!v || !UUID_RE.test(v)) return null;
  return v;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }
  const companyId = readCompanyIdFromQuery(req);
  if (!companyId) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await getPostMaster({ postId: id, companyId });
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
      data: { post: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, master_text?: string|null, link_url?: string|null }.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await updatePostMaster({
    postId: id,
    companyId: parsed.data.company_id,
    masterText: parsed.data.master_text,
    linkUrl: parsed.data.link_url,
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
      data: { post: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }
  const companyId = readCompanyIdFromQuery(req);
  if (!companyId) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "edit_post");
  if (gate.kind === "deny") return gate.response;

  // Service role keeps the operation auditable even when the caller's
  // RLS scope wouldn't let them DELETE under a direct query — gate
  // already authorised the action.
  void getServiceRoleClient;

  const result = await deletePostMaster({ postId: id, companyId });
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
