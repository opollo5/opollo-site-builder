import { NextResponse } from "next/server";
import { z } from "zod";
import { toZonedTime } from "date-fns-tz";

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
import {
  isTerminalForMutation,
  type PostState,
} from "@/lib/social/post-state-actions";

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
// Two accepted body shapes:
//
//   V1 (legacy): { draft_version, draft_data }
//     — Saves raw draft_data blob. Used by CAP and direct V1 callers.
//
//   V2 (composer edit): { draft_version, content, target_profile_ids, … }
//     — Discriminated by presence of the 'content' field.
//     — Writes both top-level columns (content, scheduled_at, state) AND
//       mirrors them into draft_data for compatibility with the V1 publish path.
//
// Both paths: optimistic CAS check on draft_version per ADR-0002.
// Returns:
//   200  — saved draft with new draft_version
//   409  — VERSION_CONFLICT — includes current_draft in error.details
// ---------------------------------------------------------------------------

const SaveBodySchema = z.object({
  draft_version: z.number().int().positive(),
  draft_data: DraftDataSchema,
});

// V2 body — presence of 'content' distinguishes it from the legacy SaveBodySchema.
const V2SaveBodySchema = z.object({
  draft_version: z.number().int().positive(),
  content: z.string().max(63206),
  media_urls: z.array(z.string().url()).default([]),
  target_profile_ids: z.array(z.string().uuid()).default([]),
  platform_variants: z.record(
    z.string(),
    z.object({
      content: z.string().max(63206).optional(),
      link: z.string().url().optional(),
      cta: z.string().max(100).optional(),
    }),
  ).default({}),
  mode: z.enum(["post_now", "schedule", "recurring", "draft"]),
  scheduled_at: z.string().datetime().optional().nullable(),
  planned_for_at: z.string().datetime().optional().nullable(),
  approval_required: z.boolean().default(false),
  approver_user_id: z.string().uuid().optional().nullable(),
});

const MODE_TO_STATE: Record<string, string> = {
  post_now: "scheduled",
  schedule: "scheduled",
  recurring: "recurring",
  draft: "draft",
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);

  // Discriminate body shape before auth to return validation errors early.
  const isV2 = typeof body === "object" && body !== null && "content" in body && body.content !== undefined;

  // Resolve company_id from draft row (service-role peek).
  const client = getServiceRoleClient();
  const { data: row } = await client
    .from("social_post_drafts")
    .select("company_id, draft_data, draft_version, state")
    .eq("id", idCheck.value)
    .is("archived_at", null)
    .maybeSingle();

  if (!row) return notFound(`Draft ${id} not found.`);

  const gate = await requireCanDoForApi(row.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  // State guard: published + publishing rows are not mutable via PATCH.
  // Published posts are already live on the social platform; mutating
  // them via composer would silently flip state back to scheduled
  // (see MODE_TO_STATE below). Publishing rows are owned by the
  // publish job. The matrix in lib/social/post-state-actions.ts is
  // the single source of truth — keep this guard aligned with
  // isTerminalForMutation.
  const currentState = row.state as PostState;
  if (isTerminalForMutation(currentState)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_STATE",
          message: `Cannot modify post in state '${currentState}'.`,
          retryable: false,
          suggested_action:
            currentState === "published"
              ? "Use repost-as-new to clone this post into a new draft."
              : "Wait for the publish job to finish, then retry if needed.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  if (isV2) {
    const parsed = parseBodyWith(V2SaveBodySchema, body);
    if (!parsed.ok) return parsed.response;

    const {
      draft_version,
      content,
      media_urls,
      target_profile_ids,
      platform_variants,
      mode,
      scheduled_at,
      planned_for_at,
      approval_required,
      approver_user_id,
    } = parsed.data;

    // Fetch company timezone to populate draft_data.schedule for V1 publish-path compatibility.
    const { data: company } = await client
      .from("platform_companies")
      .select("timezone")
      .eq("id", row.company_id as string)
      .maybeSingle();
    const tz = (company?.timezone as string | undefined) ?? "UTC";

    // Derive V1-compatible draft_data.schedule from the UTC scheduled_at.
    let scheduleLocal: { date: string; times: string[] } | null = null;
    if (scheduled_at) {
      const local = toZonedTime(new Date(scheduled_at), tz);
      const yyyy = local.getFullYear();
      const mm = String(local.getMonth() + 1).padStart(2, "0");
      const dd = String(local.getDate()).padStart(2, "0");
      const hh = String(local.getHours()).padStart(2, "0");
      const min = String(local.getMinutes()).padStart(2, "0");
      scheduleLocal = { date: `${yyyy}-${mm}-${dd}`, times: [`${hh}:${min}`] };
    }

    // Merge V2 fields into the existing draft_data blob, preserving any fields
    // the V2 composer doesn't know about (ai_metadata, link_url, etc.).
    const existingDraftData = (row.draft_data ?? {}) as Record<string, unknown>;
    const updatedDraftData = DraftDataSchema.parse({
      ...existingDraftData,
      master_text: content,
      media_refs: media_refs_from_urls(media_urls),
      target_connection_ids: target_profile_ids,
      approval_required,
      schedule: scheduleLocal,
    });

    const effectiveScheduledAt =
      mode === "post_now" ? new Date().toISOString() : (scheduled_at ?? null);

    const { data: updated, error } = await client
      .from("social_post_drafts")
      .update({
        updated_by: gate.userId,
        draft_version: draft_version + 1,
        content,
        media_urls,
        scheduled_at: effectiveScheduledAt,
        planned_for_at: planned_for_at ?? null,
        state: MODE_TO_STATE[mode] ?? "draft",
        approval_required,
        approver_user_id: approver_user_id ?? null,
        draft_data: updatedDraftData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", idCheck.value)
      .eq("company_id", row.company_id as string)
      .eq("draft_version", draft_version)
      .is("archived_at", null)
      .select()
      .maybeSingle();

    if (error) {
      logger.error("draft_v2_save_failed", { draft_id: id, err: error.message });
      return internalError(error.message, true);
    }

    if (!updated) {
      const current = await getDraft({ draftId: idCheck.value, companyId: row.company_id as string });
      return conflict("VERSION_CONFLICT", "Draft was modified by another tab or user.", {
        current_draft: current.ok ? current.data : null,
      });
    }

    return NextResponse.json({ ok: true, data: updated, timestamp: new Date().toISOString() });
  }

  // V1 legacy path.
  const parsed = parseBodyWith(SaveBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const { draft_version, draft_data } = parsed.data;

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

// Convert plain URL strings to the minimal MediaRef shape draft_data expects.
function media_refs_from_urls(urls: string[]): Array<{ type: "upload"; url: string }> {
  return urls.map((url) => ({ type: "upload" as const, url }));
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
