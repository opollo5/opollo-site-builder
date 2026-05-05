import "server-only";

import { logger } from "@/lib/logger";
import { cancelScheduledPublish } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  CancelScheduleEntryInput,
  ScheduleEntry,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — cancel a non-cancelled schedule entry.
//
// Atomic UPDATE WHERE cancelled_at IS NULL. Concurrent cancels
// converge: one transitions, the others see 0 rows and return
// INVALID_STATE. Cross-company access caught by checking the entry's
// variant's post belongs to companyId.
//
// QStash message cancellation lands when QStash enqueue lands
// (S1-15+). Until then, the publish-handler will pick up the entry
// and skip it because cancelled_at is non-null.
// ---------------------------------------------------------------------------

export async function cancelScheduleEntry(
  input: CancelScheduleEntryInput,
): Promise<ApiResponse<ScheduleEntry>> {
  if (!input.entryId) return validation("Entry id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // Resolve entry → variant → post → company. Two reads + atomic
  // UPDATE rather than one fancy embed (multi-FK pitfall avoided).
  const entry = await svc
    .from("social_schedule_entries")
    .select(
      "id, post_variant_id, scheduled_at, qstash_message_id, scheduled_by, cancelled_at, created_at",
    )
    .eq("id", input.entryId)
    .maybeSingle();
  if (entry.error) {
    logger.error("social.scheduling.cancel.entry_lookup_failed", {
      err: entry.error.message,
    });
    return internal(`Failed to read entry: ${entry.error.message}`);
  }
  if (!entry.data) return notFound();

  const variant = await svc
    .from("social_post_variant")
    .select("post_master_id")
    .eq("id", entry.data.post_variant_id as string)
    .maybeSingle();
  if (variant.error || !variant.data) {
    return notFound();
  }

  const post = await svc
    .from("social_post_master")
    .select("id")
    .eq("id", variant.data.post_master_id as string)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (post.error) {
    logger.error("social.scheduling.cancel.post_lookup_failed", {
      err: post.error.message,
    });
    return internal(`Failed to scope: ${post.error.message}`);
  }
  if (!post.data) {
    // Entry exists but in another company. Same NOT_FOUND envelope to
    // avoid leaking cross-company existence.
    return notFound();
  }

  if ((entry.data as ScheduleEntry).cancelled_at) {
    return invalidState("Entry is already cancelled.");
  }

  const update = await svc
    .from("social_schedule_entries")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", input.entryId)
    .is("cancelled_at", null)
    .select(
      "id, post_variant_id, scheduled_at, qstash_message_id, scheduled_by, cancelled_at, created_at",
    )
    .maybeSingle();
  if (update.error) {
    logger.error("social.scheduling.cancel.update_failed", {
      err: update.error.message,
    });
    return internal(`Failed to cancel: ${update.error.message}`);
  }
  if (!update.data) {
    // Race: another caller cancelled between our lookup and update.
    return invalidState("Entry was cancelled concurrently.");
  }

  // S1-18 — best-effort QStash message cancel. If this fails the
  // callback may still fire, but claim_publish_job's CANCELLED gate
  // (migration 0075) is the source of truth and will skip publishing.
  const cancelResult = await cancelScheduledPublish(
    (update.data as ScheduleEntry).qstash_message_id,
  );
  if (!cancelResult.ok) {
    logger.warn("social.scheduling.cancel.qstash_cancel_failed", {
      err: cancelResult.error.message,
      entry_id: input.entryId,
    });
  }

  return {
    ok: true,
    data: update.data as ScheduleEntry,
    timestamp: new Date().toISOString(),
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
