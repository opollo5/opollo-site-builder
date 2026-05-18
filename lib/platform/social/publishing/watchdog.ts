import "server-only";

import { logger } from "@/lib/logger";
import { dispatch as notifyDispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-watchdog — recover in_flight publish attempts whose lease has expired.
//
// Spec §2.4: workers set claimed_until when claiming an attempt. If the
// worker crashes (Vercel timeout, network blip, deploy mid-flight) the lease
// expires without the attempt being marked succeeded or failed.
//
// This watchdog runs every 5 minutes and marks any attempt where
// claimed_until < now() AND status = 'in_flight' as failed with
// error_class = 'worker_died', advances master state, and fires a
// post_failed notification so operators are alerted.
//
// Fallback for pre-0126 rows (claimed_until IS NULL): also catches attempts
// in_flight for >STUCK_AFTER_MINUTES without a claimed_until column value.
// This preserves backward compatibility while the deploy propagates.
//
// Idempotent: predicate-guarded on status='in_flight'.
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

  // Expired-lease attempts (post-0126 rows with claimed_until set).
  const leaseExpiredR = await svc
    .from("social_publish_attempts")
    .select("id, post_variant_id, company_id")
    .eq("status", "in_flight")
    .lt("claimed_until", new Date().toISOString())
    .not("claimed_until", "is", null);

  // Legacy fallback: pre-0126 rows where claimed_until is NULL but started_at is stale.
  const staleFallbackR = await svc
    .from("social_publish_attempts")
    .select("id, post_variant_id, company_id")
    .eq("status", "in_flight")
    .lt("started_at", cutoff)
    .is("claimed_until", null);

  if (leaseExpiredR.error) {
    logger.error("social.publish.watchdog.query_failed", { err: leaseExpiredR.error.message });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Watchdog query failed: ${leaseExpiredR.error.message}`,
        retryable: true,
        suggested_action: "Retry. If persistent, check DB connectivity.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const attemptsR = {
    data: [...(leaseExpiredR.data ?? []), ...(staleFallbackR.data ?? [])],
    error: staleFallbackR.error,
  };

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
        error_class: "worker_died",
        error_payload: {
          reason: "Worker lease expired without completing publish.",
          stuck_after_minutes: STUCK_AFTER_MINUTES,
        },
        completed_at: now,
        claimed_until: null,
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
        errorClass: "worker_died",
        errorMessage: "Worker lease expired without completing publish.",
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
