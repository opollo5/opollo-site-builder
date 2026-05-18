import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import { enqueueScheduledPublish } from "./enqueue";
import { retryPublishAttempt } from "./retry";

// ---------------------------------------------------------------------------
// S1-19 — backfill QStash messages for schedule entries that were
// created without a working QStash client (env unset at create time,
// QStash transient outage, etc).
//
// Walks social_schedule_entries WHERE qstash_message_id IS NULL AND
// cancelled_at IS NULL AND scheduled_at >= now() (entries already in
// the past would fire-immediately; we let those go via a separate
// "force fire" admin action rather than silently spamming bundle.social).
//
// For each row, calls enqueueScheduledPublish. The enqueue lib itself
// stores the new messageId on success. Idempotent across reruns:
// successful enqueues populate qstash_message_id, so the next backfill
// pass skips them. The deduplicationId on the QStash publish also
// guards against double-enqueue if two backfill ticks race.
//
// Only runs when QSTASH_TOKEN is configured. When absent, returns
// { skipped: 'no_qstash' } so the cron tick is a clean no-op.
// ---------------------------------------------------------------------------

export type BackfillInput = {
  origin: string;
  // Optional cap to keep cron ticks bounded. Default 100.
  limit?: number;
};

export type BackfillResult =
  | {
      status: "ok";
      examined: number;
      enqueued: number;
      failed: number;
      retries_attempted: number;
      retries_failed: number;
    }
  | { status: "skipped"; reason: "no_qstash" };

export async function backfillScheduledPublishes(
  input: BackfillInput,
): Promise<ApiResponse<BackfillResult>> {
  if (!input.origin) return validation("origin is required.");

  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const svc = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  // Pass 1: auto-retry — pick up failed attempts whose next_retry_at is due.
  // This runs regardless of QStash config because retryPublishAttempt calls
  // bundle.social directly.
  let retriesAttempted = 0;
  let retriesFailed = 0;
  {
    const retryRows = await svc
      .from("social_publish_attempts")
      .select("id")
      .eq("status", "failed")
      .is("dead_lettered_at", null)
      .not("next_retry_at", "is", null)
      .lte("next_retry_at", nowIso)
      .limit(limit);

    if (retryRows.error) {
      logger.warn("social.publish.backfill.retry_read_failed", {
        err: retryRows.error.message,
      });
    } else {
      for (const row of retryRows.data ?? []) {
        retriesAttempted += 1;
        const result = await retryPublishAttempt({ attemptId: row.id as string });
        if (
          !result.ok ||
          result.data.outcome === "publish_failed" ||
          result.data.outcome === "no_connection" ||
          result.data.outcome === "connection_degraded"
        ) {
          retriesFailed += 1;
          logger.warn("social.publish.backfill.retry_failed", {
            attempt_id: row.id,
            outcome: result.ok ? result.data.outcome : result.error.message,
          });
        }
      }
    }
  }

  // Pass 2: enqueue missed schedule entries (requires QStash).
  if (!process.env.QSTASH_TOKEN) {
    if (retriesAttempted === 0) {
      return {
        ok: true,
        data: { status: "skipped", reason: "no_qstash" },
        timestamp: new Date().toISOString(),
      };
    }
    return {
      ok: true,
      data: {
        status: "ok",
        examined: 0,
        enqueued: 0,
        failed: 0,
        retries_attempted: retriesAttempted,
        retries_failed: retriesFailed,
      },
      timestamp: new Date().toISOString(),
    };
  }

  const rows = await svc
    .from("social_schedule_entries")
    .select("id, scheduled_at")
    .is("qstash_message_id", null)
    .is("cancelled_at", null)
    .gte("scheduled_at", nowIso)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (rows.error) {
    logger.error("social.publish.backfill.read_failed", {
      err: rows.error.message,
    });
    return internal(`Backfill read failed: ${rows.error.message}`);
  }

  const candidates = rows.data ?? [];
  let enqueued = 0;
  let failed = 0;

  for (const row of candidates) {
    const result = await enqueueScheduledPublish({
      scheduleEntryId: row.id as string,
      scheduledAt: row.scheduled_at as string,
      origin: input.origin,
    });
    if (result.ok && result.data.messageId) {
      enqueued += 1;
    } else if (result.ok) {
      failed += 1;
    } else {
      failed += 1;
      logger.warn("social.publish.backfill.entry_failed", {
        err: result.error.message,
        schedule_entry_id: row.id,
      });
    }
  }

  return {
    ok: true,
    data: {
      status: "ok",
      examined: candidates.length,
      enqueued,
      failed,
      retries_attempted: retriesAttempted,
      retries_failed: retriesFailed,
    },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<BackfillResult> {
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

function internal(message: string): ApiResponse<BackfillResult> {
  logger.error("social.publishing.backfill.internal_error", { message });
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
