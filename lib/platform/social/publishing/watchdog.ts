import "server-only";

import { logger } from "@/lib/logger";
import { dispatch as notifyDispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-watchdog — recover in_flight publish attempts that never received a
// bundle.social webhook.
//
// When fireScheduledPublish succeeds the attempt enters 'in_flight'. The
// webhook handler (S1-17) is expected to flip it to 'succeeded' / 'failed'
// within seconds. If the webhook is lost or bundle.social never sends it,
// the attempt stays stuck indefinitely.
//
// This watchdog runs every 5 minutes and marks any attempt that has been
// in_flight for >STUCK_AFTER_MINUTES as 'failed', advances the master state,
// and fires a post_failed notification so operators are alerted.
//
// Idempotent: the attempt update is predicate-guarded on status='in_flight',
// so concurrent runs are safe and manual retries are benign.
// ---------------------------------------------------------------------------

const STUCK_AFTER_MINUTES = 3;

export type WatchdogResult = {
  examined: number;
  recovered: number;
  errors: number;
};

export async function runPublishWatchdog(): Promise<ApiResponse<WatchdogResult>> {
  const svc = getServiceRoleClient();
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString();

  const attemptsR = await svc
    .from("social_publish_attempts")
    .select("id, post_variant_id, company_id")
    .eq("status", "in_flight")
    .lt("started_at", cutoff);

  if (attemptsR.error) {
    logger.error("social.publish.watchdog.query_failed", {
      err: attemptsR.error.message,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Watchdog query failed: ${attemptsR.error.message}`,
        retryable: true,
        suggested_action: "Retry. If persistent, check DB connectivity.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const attempts = attemptsR.data ?? [];
  const now = new Date().toISOString();
  let recovered = 0;
  let errors = 0;

  for (const attempt of attempts) {
    const attemptId = attempt.id as string;
    const variantId = attempt.post_variant_id as string;
    const companyId = attempt.company_id as string;

    // Predicate-guarded update — safe if another watchdog tick or a
    // concurrent webhook already resolved this attempt.
    const attemptUpdate = await svc
      .from("social_publish_attempts")
      .update({
        status: "failed",
        error_class: "timeout",
        error_payload: {
          reason: `No webhook received after ${STUCK_AFTER_MINUTES} minutes.`,
        },
        completed_at: now,
      })
      .eq("id", attemptId)
      .eq("status", "in_flight");

    if (attemptUpdate.error) {
      logger.warn("social.publish.watchdog.attempt_update_failed", {
        err: attemptUpdate.error.message,
        attempt_id: attemptId,
      });
      errors++;
      continue;
    }

    // Resolve variant to get post_master_id + platform.
    const variantR = await svc
      .from("social_post_variant")
      .select("post_master_id, platform")
      .eq("id", variantId)
      .maybeSingle();

    const masterId = (variantR.data?.post_master_id as string | undefined) ?? null;
    const platform = (variantR.data?.platform as string | undefined) ?? "";

    if (!masterId) {
      logger.warn("social.publish.watchdog.variant_not_found", {
        variant_id: variantId,
        attempt_id: attemptId,
      });
      recovered++;
      continue;
    }

    // Advance master state. Predicate-guarded so a concurrent webhook that
    // already succeeded won't be overwritten.
    const masterUpdate = await svc
      .from("social_post_master")
      .update({ state: "failed", state_changed_at: now })
      .eq("id", masterId)
      .eq("state", "publishing");

    if (masterUpdate.error) {
      logger.warn("social.publish.watchdog.master_update_failed", {
        err: masterUpdate.error.message,
        master_id: masterId,
      });
    }

    // Fetch master metadata for notification dispatch.
    const masterMetaR = await svc
      .from("social_post_master")
      .select("created_by")
      .eq("id", masterId)
      .maybeSingle();

    const submitterId =
      (masterMetaR.data?.created_by as string | undefined) ?? "";

    if (companyId && submitterId && platform) {
      void notifyDispatch({
        event: "post_failed",
        companyId,
        postMasterId: masterId,
        submitterUserId: submitterId,
        platform,
        errorClass: "timeout",
        errorMessage: `Publish timed out after ${STUCK_AFTER_MINUTES} minutes — no webhook received.`,
      });
    }

    recovered++;
  }

  return {
    ok: true,
    data: { examined: attempts.length, recovered, errors },
    timestamp: new Date().toISOString(),
  };
}
