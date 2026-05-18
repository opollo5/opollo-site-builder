import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getDraft, saveDraft, DraftDataSchema } from "@/lib/platform/social/drafts";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  forbidden,
  internalError,
  notFound,
  readJsonBody,
  parseBodyWith,
  validationError,
  validateUuidParam,
  conflict,
} from "@/lib/http";

// ---------------------------------------------------------------------------
// GET /api/platform/social/drafts/[id]
//
// Loads a draft. Requires "edit_post" permission in the draft's company.
// Returns the full draft row.
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  // Load draft first to get company_id for the gate.
  // We use service-role here for the load; the gate enforces auth after.
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const client = getServiceRoleClient();
  const { data: row } = await client
    .from("social_post_drafts")
    .select("company_id")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!row) return notFound(`Draft ${id} not found.`);

  const gate = await requireCanDoForApi(row.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await getDraft({ draftId: idCheck.value, companyId: row.company_id as string });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") return notFound(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/platform/social/drafts/[id]
//
// Saves draft content with optimistic CAS check per ADR-0002.
// Body: { draft_version: number, draft_data: DraftData }
//
// Returns:
//   200  — saved draft with new draft_version
//   409  — VERSION_CONFLICT — includes current_draft in error.details
// ---------------------------------------------------------------------------

const SaveBodySchema = z.object({
  draft_version: z.number().int().positive(),
  draft_data: DraftDataSchema,
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(SaveBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const { draft_version, draft_data } = parsed.data;

  // Resolve company_id from draft row (service-role peek).
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const client = getServiceRoleClient();
  const { data: row } = await client
    .from("social_post_drafts")
    .select("company_id")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!row) return notFound(`Draft ${id} not found.`);

  const gate = await requireCanDoForApi(row.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await saveDraft({
    draftId: idCheck.value,
    companyId: row.company_id as string,
    userId: gate.userId,
    expectedVersion: draft_version,
    draftData: draft_data,
  });

  if (!result.ok) {
    if (result.error.code === "VERSION_CONFLICT") {
      return conflict("VERSION_CONFLICT", result.error.message, result.error.details);
    }
    logger.error("draft_save_failed", {
      draft_id: id,
      error_code: result.error.code,
    });
    return internalError(result.error.message, result.error.retryable);
  }

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/platform/social/drafts/[id]
//
// Soft-deletes a draft (sets archived_at). Cannot delete published/publishing
// drafts (returns 409). Requires "edit_post" permission.
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const client = getServiceRoleClient();
  const { data: row } = await client
    .from("social_post_drafts")
    .select("company_id, state")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!row) return notFound(`Draft ${id} not found.`);

  if ((row.state as string) === "published" || (row.state as string) === "publishing") {
    return conflict("CONFLICT", `Draft in state '${row.state as string}' cannot be deleted.`);
  }

  const gate = await requireCanDoForApi(row.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const { error } = await client
    .from("social_post_drafts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", idCheck.value);

  if (error) {
    logger.error("draft_delete_failed", { draft_id: id, err: error.message });
    return internalError("Failed to delete draft.");
  }

  return new NextResponse(null, { status: 204 });
}
