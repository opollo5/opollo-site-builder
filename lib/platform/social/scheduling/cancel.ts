import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  CancelScheduleEntryInput,
  ScheduleEntry,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — cancel a scheduled draft.
//
// V2: draft must be in state='scheduled'. Sets scheduled_at=null and
// state='pending_approval'. Cross-company isolation enforced by
// company_id predicate on the update.
// ---------------------------------------------------------------------------

export async function cancelScheduleEntry(
  input: CancelScheduleEntryInput,
): Promise<ApiResponse<ScheduleEntry>> {
  if (!input.entryId) return validation("Entry id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  const v2draft = await svc
    .from("social_post_drafts")
    .select("id, state, scheduled_at")
    .eq("id", input.entryId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (!v2draft.data) return notFound();

  if ((v2draft.data.state as string) !== "scheduled") {
    return invalidState(
      `Draft is in state '${v2draft.data.state as string}' — no active schedule to cancel.`,
    );
  }

  const { error } = await svc
    .from("social_post_drafts")
    .update({
      scheduled_at: null,
      state: "pending_approval",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.entryId)
    .eq("company_id", input.companyId)
    .eq("state", "scheduled");
  if (error) {
    return internal(`Failed to cancel schedule: ${error.message}`);
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    data: {
      id: input.entryId,
      post_variant_id: input.entryId,
      scheduled_at: (v2draft.data.scheduled_at as string | null) ?? now,
      qstash_message_id: null,
      scheduled_by: null,
      cancelled_at: now,
      created_at: now,
    },
    timestamp: now,
  };
}

function validation(message: string): ApiResponse<ScheduleEntry> {
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

function notFound(): ApiResponse<ScheduleEntry> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No schedule entry with that id in this company.",
      retryable: false,
      suggested_action: "Check the entry id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function invalidState(message: string): ApiResponse<ScheduleEntry> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action: "Reload and try again if needed.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<ScheduleEntry> {
  logger.error("social.scheduling.cancel.internal_error", { message });
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
