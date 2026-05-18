import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { internalError, readJsonBody, validationError, parseBodyWith } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  authenticateRequest,
  validateServiceActorCompany,
  recordServiceAction,
} from "@/lib/platform/auth/service-auth";
import { createDraft } from "@/lib/platform/social/drafts";
import { getServiceRoleClient } from "@/lib/supabase";
import { CreateDraftSchema } from "@/lib/social/schemas/create-draft";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts
//
// V1 path (legacy): Body = { company_id, idempotency_key? } — blank draft.
// V2 path (composer V2): Body includes `content`, `mode`, `target_profile_ids` etc.
//   Detected by presence of `mode` field. Gated by FEATURE_COMPOSER_V2.
//
// Auth path A — user session: requires "create_post" permission.
// Auth path B — service key: x-platform-service-key + x-platform-actor-id headers.
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const body = await readJsonBody(req);

  if (typeof body !== "object" || body === null) {
    return validationError("Request body must be a JSON object.");
  }

  const bodyObj = body as Record<string, unknown>;

  // V2 path: `mode` field present AND feature flag enabled.
  if ("mode" in bodyObj && process.env.NEXT_PUBLIC_FEATURE_COMPOSER_V2 === "true") {
    return handleV2Post(req, bodyObj);
  }

  // V1 legacy path.
  if (typeof bodyObj.company_id !== "string") {
    return validationError("company_id is required.");
  }

  const companyId = bodyObj.company_id as string;
  const idempotencyKey = typeof bodyObj.idempotency_key === "string" ? bodyObj.idempotency_key : undefined;

  const auth = await authenticateRequest(req);
  if (auth.kind === "deny") return auth.response;

  let userId: string;

  if (auth.kind === "service") {
    const companyCheck = await validateServiceActorCompany(companyId);
    if (!companyCheck.ok) return companyCheck.response;
    recordServiceAction(companyId, auth.actorId, { route: "POST /api/platform/social/drafts" });
    userId = auth.actorId;
  } else {
    const gate = await requireCanDoForApi(companyId, "create_post");
    if (gate.kind === "deny") return gate.response;
    userId = gate.userId;
  }

  const result = await createDraft({ companyId, userId, idempotencyKey });
  if (!result.ok) {
    logger.error("draft_create_failed", { company_id: companyId, error: result.error });
    return internalError(result.error.message, result.error.retryable);
  }

  return NextResponse.json(result, { status: 201 });
}

async function handleV2Post(req: Request, bodyObj: Record<string, unknown>): Promise<NextResponse> {
  if (typeof bodyObj.company_id !== "string") {
    return validationError("company_id is required.");
  }
  const companyId = bodyObj.company_id as string;

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;
  const userId = gate.userId;

  // Rate limit: 60/min per user for single-draft creates.
  const rl = await checkRateLimit("chat", `user:${userId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const parsed = parseBodyWith(CreateDraftSchema, bodyObj);
  if (!parsed.ok) return parsed.response;

  const input = parsed.data;
  const svc = getServiceRoleClient();

  const batchId =
    input.mode === "recurring" || (input.scheduled_at_list && input.scheduled_at_list.length > 1)
      ? crypto.randomUUID()
      : undefined;

  const draftsToInsert: Record<string, unknown>[] = [];

  if (input.mode === "recurring" && input.recurrence) {
    // Parent row.
    const parentId = crypto.randomUUID();
    draftsToInsert.push({
      id: parentId,
      company_id: companyId,
      created_by: userId,
      updated_by: userId,
      state: input.approval_required ? "pending_approval" : "recurring",
      content: input.content,
      media_urls: input.media_urls,
      target_profiles: input.target_profile_ids.map((id) => ({ profile_id: id })),
      platform_variants: input.platform_variants,
      approval_required: input.approval_required,
      approver_user_id: input.approver_user_id ?? null,
      recurrence_rule: input.recurrence.rule,
      recurrence_starting_at: input.recurrence.starting_at,
      recurrence_until: input.recurrence.until ?? null,
      recurrence_state: "active",
      batch_id: batchId ?? null,
    });
    // First 6 child rows.
    for (let i = 0; i < 6; i++) {
      draftsToInsert.push({
        company_id: companyId,
        created_by: userId,
        updated_by: userId,
        state: input.approval_required ? "pending_approval" : "scheduled",
        content: input.content,
        media_urls: input.media_urls,
        target_profiles: input.target_profile_ids.map((id) => ({ profile_id: id })),
        platform_variants: input.platform_variants,
        approval_required: input.approval_required,
        approver_user_id: input.approver_user_id ?? null,
        parent_draft_id: parentId,
        occurrence_index: i,
        batch_id: batchId ?? null,
      });
    }
  } else if (input.mode === "schedule" && input.scheduled_at_list?.length) {
    for (const ts of input.scheduled_at_list) {
      draftsToInsert.push({
        company_id: companyId,
        created_by: userId,
        updated_by: userId,
        state: input.approval_required ? "pending_approval" : "scheduled",
        content: input.content,
        media_urls: input.media_urls,
        target_profiles: input.target_profile_ids.map((id) => ({ profile_id: id })),
        platform_variants: input.platform_variants,
        scheduled_at: ts,
        approval_required: input.approval_required,
        approver_user_id: input.approver_user_id ?? null,
        batch_id: batchId ?? null,
      });
    }
  } else {
    const state =
      input.mode === "post_now"
        ? input.approval_required ? "pending_approval" : "scheduled"
        : "draft";
    draftsToInsert.push({
      company_id: companyId,
      created_by: userId,
      updated_by: userId,
      state,
      content: input.content,
      media_urls: input.media_urls,
      target_profiles: input.target_profile_ids.map((id) => ({ profile_id: id })),
      platform_variants: input.platform_variants,
      scheduled_at: input.mode === "post_now" ? new Date().toISOString() : null,
      planned_for_at: input.planned_for_at ?? null,
      approval_required: input.approval_required,
      approver_user_id: input.approver_user_id ?? null,
    });
  }

  const { data: inserted, error } = await svc
    .from("social_post_drafts")
    .insert(draftsToInsert)
    .select("id, state, scheduled_at, parent_draft_id");

  if (error) {
    logger.error("draft_v2_create_failed", { companyId, err: error.message });
    return internalError("Failed to create draft.");
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        drafts: inserted,
        batch_id: batchId ?? undefined,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
