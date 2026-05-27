import "server-only";

import { logger } from "@/lib/logger";
import { getQstashClient } from "@/lib/qstash";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-18 — V1 QStash enqueue (RETIRED pr-13).
//
// enqueueScheduledPublish is now a logged no-op. All new social posts use
// the V2 publish-due cron (social_post_drafts, FOR UPDATE SKIP LOCKED).
// No new QStash messages should be enqueued after pr-07 migrated all post
// creation to social_post_drafts.
//
// cancelScheduledPublish still works — it cancels pending QStash messages
// for any V1 entries that were enqueued before this retirement.
//
// Full V1 table drop in PRs 16-17.
// ---------------------------------------------------------------------------

export type EnqueuePublishInput = {
  scheduleEntryId: string;
  scheduledAt: string; // ISO timestamp
  origin: string; // e.g. https://app.opollo.com
};

export type EnqueuePublishResult = {
  messageId: string | null; // null when QSTASH not configured
};

export async function enqueueScheduledPublish(
  input: EnqueuePublishInput,
): Promise<ApiResponse<EnqueuePublishResult>> {
  if (!input.scheduleEntryId) return validation("scheduleEntryId required.");
  if (!input.scheduledAt) return validation("scheduledAt required.");
  if (!input.origin) return validation("origin required.");

  const fireAtMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(fireAtMs)) {
    return validation("scheduledAt must be a valid ISO timestamp.");
  }

  logger.warn("social.publish.enqueue.v1_retired", {
    schedule_entry_id: input.scheduleEntryId,
    note: "V1 QStash pipeline retired (pr-13); no QStash message enqueued",
  });
  return {
    ok: true,
    data: { messageId: null },
    timestamp: new Date().toISOString(),
  };
}

// Cancel a previously-enqueued QStash callback. Called from
// cancelScheduleEntry after it stamps the entry's cancelled_at.
//
// Best-effort: a failure here just means the callback might still fire
// at scheduled_at, but the schedule_entry.cancelled_at gate inside
// claim_publish_job (migration 0075) is the source of truth — the
// fired callback will return CANCELLED and skip the publish.
export async function cancelScheduledPublish(
  messageId: string | null,
): Promise<ApiResponse<{ cancelled: boolean }>> {
  if (!messageId) {
    return {
      ok: true,
      data: { cancelled: false },
      timestamp: new Date().toISOString(),
    };
  }

  const client = getQstashClient();
  if (!client) {
    return {
      ok: true,
      data: { cancelled: false },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    await client.messages.delete(messageId);
    return {
      ok: true,
      data: { cancelled: true },
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 404 from QStash = already delivered or already cancelled — both
    // are fine outcomes for our use case.
    if (message.includes("404") || message.toLowerCase().includes("not found")) {
      return {
        ok: true,
        data: { cancelled: false },
        timestamp: new Date().toISOString(),
      };
    }
    logger.warn("social.publish.enqueue.cancel_failed", {
      err: message,
      message_id: messageId,
    });
    return internal(`QStash cancel failed: ${message}`);
  }
}

function validation<T>(message: string): ApiResponse<T> {
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

function internal<T>(message: string): ApiResponse<T> {
  logger.error("social.publishing.enqueue.internal_error", { message });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: true,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
