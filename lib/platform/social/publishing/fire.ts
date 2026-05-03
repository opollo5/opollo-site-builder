import "server-only";

import {
  getBundlesocialClient,
  getBundlesocialTeamId,
} from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-18 — fire a scheduled publish (called by the QStash callback).
//
// Flow:
//   1. RPC claim_publish_job(scheduleEntryId) — atomic state advance,
//      job + attempt rows inserted, master state → 'publishing'.
//      Outcome 'OK' = we own the publish; anything else = no-op.
//   2. Compose bundle.social postCreate request from the claim's
//      returned variant_text/master_text + bundle_social_account_id.
//   3. Call client.post.postCreate. Status 'POSTED' / 'SCHEDULED' /
//      'PROCESSING' = success — store the bundle.social post id on
//      the attempt. Status 'ERROR' = treat as failure.
//   4. The actual platform-side success / failure lands as a
//      bundle.social webhook later (post.published / post.failed) —
//      that's S1-17's job to flip status to 'succeeded' / 'failed'
//      and advance master state. Until that arrives the attempt
//      stays in 'in_flight' (or 'unknown' if the bundle.social call
//      itself errored).
//
// Note we deliberately do NOT spend twice on retries: claim_publish_job
// is the single place that locks the schedule_entry; if it returns
// ALREADY_CLAIMED the caller exits without calling bundle.social again.
// QStash redelivery is benign.
// ---------------------------------------------------------------------------

export type FirePublishInput = {
  scheduleEntryId: string;
};

export type FirePublishResult = {
  outcome:
    | "ok"
    | "already_claimed"
    | "cancelled"
    | "not_found"
    | "invalid_state"
    | "no_connection"
    | "connection_degraded"
    | "publish_failed";
  publishJobId?: string;
  publishAttemptId?: string;
  bundlePostId?: string;
};

type ClaimRow = {
  outcome: string;
  publish_job_id: string | null;
  publish_attempt_id: string | null;
  post_master_id: string | null;
  post_variant_id: string | null;
  company_id: string | null;
  platform: string | null;
  variant_text: string | null;
  master_text: string | null;
  link_url: string | null;
  bundle_social_account_id: string | null;
};

const PLATFORM_TO_BUNDLE: Record<
  string,
  "LINKEDIN" | "FACEBOOK" | "TWITTER" | "GOOGLE_BUSINESS"
> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export async function fireScheduledPublish(
  input: FirePublishInput,
): Promise<ApiResponse<FirePublishResult>> {
  if (!input.scheduleEntryId) {
    return validation("scheduleEntryId is required.");
  }

  const svc = getServiceRoleClient();

  // Step 1: atomic claim.
  const claimResult = await svc.rpc("claim_publish_job", {
    p_schedule_entry_id: input.scheduleEntryId,
  });
  if (claimResult.error) {
    logger.error("social.publish.fire.claim_failed", {
      err: claimResult.error.message,
      schedule_entry_id: input.scheduleEntryId,
    });
    return internal(`claim_publish_job RPC failed: ${claimResult.error.message}`);
  }
  const rows = (claimResult.data as ClaimRow[] | null) ?? [];
  const claim = rows[0];
  if (!claim) {
    return internal("claim_publish_job returned no row.");
  }

  if (claim.outcome === "NOT_FOUND") {
    return ok({ outcome: "not_found" });
  }
  if (claim.outcome === "CANCELLED") {
    return ok({ outcome: "cancelled" });
  }
  if (claim.outcome === "INVALID_STATE") {
    return ok({ outcome: "invalid_state" });
  }
  if (claim.outcome === "NO_CONNECTION") {
    return ok({ outcome: "no_connection" });
  }
  if (claim.outcome === "CONNECTION_DEGRADED") {
    return ok({ outcome: "connection_degraded" });
  }
  if (claim.outcome === "ALREADY_CLAIMED") {
    return ok({ outcome: "already_claimed" });
  }
  if (claim.outcome !== "OK") {
    return internal(`Unexpected claim outcome: ${claim.outcome}`);
  }

  // Step 2: bundle.social call.
  const client = getBundlesocialClient();
  const teamId = getBundlesocialTeamId();
  if (!client || !teamId) {
    // We've already claimed the job + advanced master state. Mark the
    // attempt failed so the next manual retry path can pick it up;
    // master state will be flipped to 'failed' by the operator (or
    // the future cleanup cron). Don't re-enter the QStash queue.
    await markAttemptFailed(svc, claim.publish_attempt_id!, {
      error_class: "platform_error",
      error_payload: { code: "RECEIVER_NOT_CONFIGURED" },
    });
    await markMasterFailed(svc, claim.post_master_id!);
    return internal("bundle.social client not configured.");
  }

  const bundlePlatform = PLATFORM_TO_BUNDLE[claim.platform!];
  if (!bundlePlatform) {
    await markAttemptFailed(svc, claim.publish_attempt_id!, {
      error_class: "unknown",
      error_payload: { reason: `Unsupported platform: ${claim.platform}` },
    });
    await markMasterFailed(svc, claim.post_master_id!);
    return internal(`Unsupported platform: ${claim.platform}`);
  }

  const text = (claim.variant_text ?? claim.master_text ?? "").trim();
  if (!text) {
    await markAttemptFailed(svc, claim.publish_attempt_id!, {
      error_class: "content_rejected",
      error_payload: { reason: "Empty post body" },
    });
    await markMasterFailed(svc, claim.post_master_id!);
    return internal("Post has no body text.");
  }

  // Compose the data block per bundle.social platform shape. V1: text
  // only; media uploads are S1-19+.
  const data: Record<string, unknown> = {};
  if (bundlePlatform === "LINKEDIN") {
    data.LINKEDIN = { text, link: claim.link_url ?? undefined };
  } else if (bundlePlatform === "FACEBOOK") {
    data.FACEBOOK = { text, link: claim.link_url ?? undefined };
  } else if (bundlePlatform === "TWITTER") {
    data.TWITTER = { text };
  } else if (bundlePlatform === "GOOGLE_BUSINESS") {
    data.GOOGLE_BUSINESS = { text, link: claim.link_url ?? undefined };
  }

  let bundlePostId: string | null = null;
  let bundleStatus: string | null = null;
  try {
    const response = (await client.post.postCreate({
      requestBody: {
        teamId,
        title: `attempt:${claim.publish_attempt_id}`,
        postDate: new Date().toISOString(),
        status: "SCHEDULED",
        socialAccountTypes: [bundlePlatform],
        data: data as never,
      },
    })) as { id?: string; status?: string };
    bundlePostId = response.id ?? null;
    bundleStatus = response.status ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.publish.fire.bundle_post_failed", {
      err: message,
      attempt_id: claim.publish_attempt_id,
    });
    await markAttemptFailed(svc, claim.publish_attempt_id!, {
      error_class: classifyError(message),
      error_payload: { message },
    });
    await markMasterFailed(svc, claim.post_master_id!);
    return ok({ outcome: "publish_failed" });
  }

  // bundle.social may return status='ERROR' synchronously even with a
  // 200 response — treat that as a failure.
  if (bundleStatus === "ERROR") {
    await markAttemptFailed(svc, claim.publish_attempt_id!, {
      error_class: "platform_error",
      error_payload: { bundle_status: bundleStatus, bundle_id: bundlePostId },
    });
    await markMasterFailed(svc, claim.post_master_id!);
    return ok({ outcome: "publish_failed" });
  }

  // Success path: store the bundle.social post id on the attempt.
  // Webhook (S1-17) will flip status to 'succeeded' on post.published
  // and master state to 'published'. Until then attempt stays
  // 'in_flight' which the dashboard surfaces as "publishing…".
  if (bundlePostId) {
    const update = await svc
      .from("social_publish_attempts")
      .update({
        bundle_post_id: bundlePostId,
        request_payload: { socialAccountTypes: [bundlePlatform], data },
        response_payload: { id: bundlePostId, status: bundleStatus },
      })
      .eq("id", claim.publish_attempt_id!);
    if (update.error) {
      logger.warn("social.publish.fire.bundle_id_store_failed", {
        err: update.error.message,
        attempt_id: claim.publish_attempt_id,
      });
    }
  }

  return ok({
    outcome: "ok",
    publishJobId: claim.publish_job_id!,
    publishAttemptId: claim.publish_attempt_id!,
    bundlePostId: bundlePostId ?? undefined,
  });
}

async function markAttemptFailed(
  svc: ReturnType<typeof getServiceRoleClient>,
  attemptId: string,
  fields: { error_class: string; error_payload: Record<string, unknown> },
): Promise<void> {
  const update = await svc
    .from("social_publish_attempts")
    .update({
      status: "failed",
      error_class: fields.error_class,
      error_payload: fields.error_payload,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId);
  if (update.error) {
    logger.warn("social.publish.fire.attempt_fail_failed", {
      err: update.error.message,
      attempt_id: attemptId,
    });
  }
}

async function markMasterFailed(
  svc: ReturnType<typeof getServiceRoleClient>,
  masterId: string,
): Promise<void> {
  const update = await svc
    .from("social_post_master")
    .update({ state: "failed", state_changed_at: new Date().toISOString() })
    .eq("id", masterId)
    .eq("state", "publishing");
  if (update.error) {
    logger.warn("social.publish.fire.master_fail_failed", {
      err: update.error.message,
      master_id: masterId,
    });
  }
}

function classifyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("429")) return "rate_limit";
  if (m.includes("401") || m.includes("403") || m.includes("unauth")) {
    return "auth";
  }
  if (m.includes("400") || m.includes("invalid")) return "content_rejected";
  if (m.includes("network") || m.includes("timeout") || m.includes("econn")) {
    return "network";
  }
  return "platform_error";
}

function ok(data: FirePublishResult): ApiResponse<FirePublishResult> {
  return {
    ok: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<FirePublishResult> {
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

function internal(message: string): ApiResponse<FirePublishResult> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Investigate logs; the publish_attempt may be in an inconsistent state.",
    },
    timestamp: new Date().toISOString(),
  };
}
