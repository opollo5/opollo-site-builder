import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { internalError, notFound, validationError, validateUuidParam } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts/[id]/convert-to-draft
//
// Converts a scheduled post back to draft state:
//   - state = 'draft'
//   - scheduled_at = NULL
// Only valid when the post is in 'scheduled' state.
// Requires "edit_post" permission in the draft's company.
// ---------------------------------------------------------------------------

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("id, company_id, state")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!draft) return notFound(`Draft ${id} not found.`);

  if ((draft.state as string) !== "scheduled") {
    return validationError(
      `Draft is in state '${draft.state as string}', not scheduled. Only scheduled posts can be converted to draft.`,
    );
  }

  const gate = await requireCanDoForApi(draft.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const { error } = await svc
    .from("social_post_drafts")
    .update({
      state: "draft",
      scheduled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", idCheck.value);

  if (error) {
    logger.error("convert_to_draft.update_failed", { draftId: id, err: error.message });
    return internalError("Failed to convert draft to draft state.");
  }

  return NextResponse.json({
    ok: true,
    data: { id: idCheck.value, state: "draft" },
    timestamp: new Date().toISOString(),
  });
}
