import "server-only";

import { logger } from "@/lib/logger";
import { SUPPORTED_PLATFORMS } from "@/lib/platform/social/variants/types";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  CreateScheduleEntryInput,
  ScheduleEntryWithPlatform,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — schedule a single (post, platform, datetime) tuple.
//
// V2: updates scheduled_at on the social_post_drafts row. Draft must be
// in state='scheduled' (set by the approval flow).
//
// Caller is responsible for canDo("schedule_post", company_id).
// ---------------------------------------------------------------------------

export async function createScheduleEntry(
  input: CreateScheduleEntryInput,
): Promise<ApiResponse<ScheduleEntryWithPlatform>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");
  if (!SUPPORTED_PLATFORMS.includes(input.platform)) {
    return validation(`Unsupported platform: ${input.platform}.`);
  }

  const scheduledAtMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(scheduledAtMs)) {
    return validation("scheduled_at must be a valid ISO timestamp.");
  }
  if (scheduledAtMs <= Date.now()) {
    return validation("scheduled_at must be in the future.");
  }

  const svc = getServiceRoleClient();

  // V2 dispatch: if the post is in social_post_drafts, set scheduled_at on the draft.
  const v2draft = await svc
    .from("social_post_drafts")
    .select("id, state")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (v2draft.data) {
    if ((v2draft.data.state as string) !== "scheduled") {
      return invalidState(
        `Draft is in state '${v2draft.data.state as string}', not 'scheduled'. Only approved drafts can be scheduled.`,
      );
    }
    const { error } = await svc
      .from("social_post_drafts")
      .update({ scheduled_at: input.scheduledAt, updated_at: new Date().toISOString() })
      .eq("id", input.postMasterId)
      .eq("company_id", input.companyId)
      .eq("state", "scheduled");
    if (error) {
      return internal(`Failed to set scheduled_at on draft: ${error.message}`);
    }
    const now = new Date().toISOString();
    return {
      ok: true,
      data: {
        id: input.postMasterId,
        post_variant_id: input.postMasterId,
        scheduled_at: input.scheduledAt,
        qstash_message_id: null,
        scheduled_by: input.scheduledBy,
        cancelled_at: null,
        created_at: now,
        platform: input.platform,
      },
      timestamp: now,
    };
  }

  return notFound();
}

function validation(message: string): ApiResponse<ScheduleEntryWithPlatform> {
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

function notFound(): ApiResponse<ScheduleEntryWithPlatform> {
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

function invalidState(message: string): ApiResponse<ScheduleEntryWithPlatform> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; the post or schedule may have moved.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<ScheduleEntryWithPlatform> {
  logger.error("social.scheduling.create.internal_error", { message });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
