import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  ListScheduleEntriesInput,
  ScheduleEntryWithPlatform,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — list schedule entries for a post (V2).
//
// Returns a synthetic entry from social_post_drafts.scheduled_at.
// Caller is responsible for canDo("view_calendar", company_id).
// ---------------------------------------------------------------------------

export async function listScheduleEntries(
  input: ListScheduleEntriesInput,
): Promise<ApiResponse<{ entries: ScheduleEntryWithPlatform[] }>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // V2 dispatch: if the post is in social_post_drafts, return a synthetic entry.
  const v2draft = await svc
    .from("social_post_drafts")
    .select("id, scheduled_at, target_profiles")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (!v2draft.data) return notFound();

  const scheduledAt = v2draft.data.scheduled_at as string | null;
  if (!scheduledAt) {
    return { ok: true, data: { entries: [] }, timestamp: new Date().toISOString() };
  }

  const profiles = (v2draft.data.target_profiles as Array<{ profile_id: string; platform: string }> | null) ?? [];
  const platform = (profiles[0]?.platform ?? "unknown") as ScheduleEntryWithPlatform["platform"];
  const now = new Date().toISOString();
  const entry: ScheduleEntryWithPlatform = {
    id: input.postMasterId,
    post_variant_id: input.postMasterId,
    scheduled_at: scheduledAt,
    qstash_message_id: null,
    scheduled_by: null,
    cancelled_at: null,
    created_at: now,
    platform,
  };
  return { ok: true, data: { entries: [entry] }, timestamp: now };
}

function validation(
  message: string,
): ApiResponse<{ entries: ScheduleEntryWithPlatform[] }> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notFound(): ApiResponse<{ entries: ScheduleEntryWithPlatform[] }> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No post with that id in this company.",
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}


