import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dispatch } from "@/lib/platform/notifications";
import { rejectPost } from "@/lib/platform/social/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const Schema = z.object({
  company_id: dbUuid(),
  comment: z.string().max(1000).trim().nullish(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return validationError("Body must be { company_id: uuid }.");

  const gate = await requireCanDoForApi(parsed.data.company_id, "reject_post");
  if (gate.kind === "deny") return gate.response;

  const comment = parsed.data.comment ?? null;
  const result = await rejectPost({ postId: id, companyId: parsed.data.company_id, comment });
  if (!result.ok) return respond(result);

  if (result.data.createdBy) {
    void dispatch({
      event: "approval_decided",
      companyId: parsed.data.company_id,
      postMasterId: id,
      submitterUserId: result.data.createdBy,
      decision: "rejected",
      comment: result.data.comment ?? undefined,
    });
  }

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
