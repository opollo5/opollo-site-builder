import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  deletePostMaster,
  getPostMaster,
  updatePostMaster,
} from "@/lib/platform/social/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PatchSchema = z.object({
  company_id: dbUuid(),
  master_text: z.string().max(10_000).nullable().optional(),
  link_url: z.string().max(2048).nullable().optional(),
});

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
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const companyId = readCompanyIdFromQuery(req);
  if (!companyId) return validationError("company_id query parameter is required.");

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await getPostMaster({ postId: id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { post: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, master_text?: string|null, link_url?: string|null }.",
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
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: { post: result.data }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const companyId = readCompanyIdFromQuery(req);
  if (!companyId) return validationError("company_id query parameter is required.");

  const gate = await requireCanDoForApi(companyId, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await deletePostMaster({ postId: id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
