import "server-only";

import { logger } from "@/lib/logger";
import { getQstashClient } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-18 — enqueue a QStash callback for a scheduled publish.
//
// Called from createScheduleEntry (after the row is inserted) with
// the entry id + the absolute scheduled_at. Schedules a single QStash
// message that POSTs back to /api/webhooks/qstash/social-publish at
// the scheduled time. Stores the QStash messageId on the schedule
// entry so cancellation can call back.
//
// Idempotency:
//   - QStash deduplicationId = `social-publish-${scheduleEntryId}`. If
//     this lib runs twice (route retry) the second publishJSON returns
//     the same messageId without duplicating the queued job.
//   - The schedule_entry's qstash_message_id is set unconditionally
//     after a successful publishJSON; any prior id was for the SAME
//     logical scheduled job (per the deduplicationId scope).
//
// Degraded path: when QSTASH_TOKEN is unset (local dev without
// Upstash, CI without provisioning) we no-op + log. The schedule entry
// row still exists; an operator-triggered backfill cron (future slice)
// can re-enqueue once QSTASH is wired.
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

  const client = getQstashClient();
  if (!client) {
    logger.info("social.publish.enqueue.skipped_no_qstash", {
      schedule_entry_id: input.scheduleEntryId,
    });
    return {
      ok: true,
      data: { messageId: null },
      timestamp: new Date().toISOString(),
    };
  }

  // QStash takes a delay in seconds. For past/now timestamps we still
  // enqueue at delay=1 so the callback fires immediately rather than
  // silently dropping (createScheduleEntry already rejected past
  // timestamps but a backfill caller might pass one).
  const delaySeconds = Math.max(1, Math.floor((fireAtMs - Date.now()) / 1000));

  const callbackUrl = `${input.origin.replace(/\/+$/, "")}/api/webhooks/qstash/social-publish`;

  let messageId: string | null = null;
  try {
    const response = (await client.publishJSON({
      url: callbackUrl,
      body: { scheduleEntryId: input.scheduleEntryId },
      delay: delaySeconds,
      // Idempotent across re-enqueues for the same logical job. QStash
      // returns the existing messageId on collision.
      deduplicationId: `social-publish-${input.scheduleEntryId}`,
    })) as { messageId?: string };
    messageId = response.messageId ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.publish.enqueue.publish_failed", {
      err: message,
      schedule_entry_id: input.scheduleEntryId,
    });
    return internal(`QStash publish failed: ${message}`);
  }

  if (messageId) {
    const svc = getServiceRoleClient();
    const update = await svc
      .from("social_schedule_entries")
      .update({ qstash_message_id: messageId })
      .eq("id", input.scheduleEntryId);
    if (update.error) {
      // Log but don't fail — the QStash job is queued, the messageId
      // just isn't stored. Cancellation lookup will fall through to
      // best-effort behaviour (the schedule_entry.cancelled_at flag is
      // the source of truth; the publish callback re-checks it).
      logger.warn("social.publish.enqueue.message_id_update_failed", {
        err: update.error.message,
        schedule_entry_id: input.scheduleEntryId,
      });
    }
  }

  return {
    ok: true,
    data: { messageId },
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
