import "server-only";

import {
  getBundlesocialClient,
  getBundlesocialTeamId,
} from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { resolveBundleUploadIds } from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-20 — operator-triggered retry of a failed publish_attempt.
//
// Calls the retry_publish_attempt RPC (migration 0076) which:
//   - Verifies attempt status='failed' + master state='failed'.
//   - Atomically flips master 'failed' → 'publishing' as the lock.
//   - Inserts a new in-flight attempt under the same publish_job,
//     with original_attempt_id pointing back at the failed one.
//
// On a successful claim we call bundle.social postCreate using the
// returned variant/master text and connection. On SDK throw or
// status='ERROR' we mark the new attempt failed + flip master back
// to 'failed' (mirroring fire.ts's failure path).
//
// Caller is responsible for canDo("schedule_post", company_id) on the
// FAILED attempt's company. The route gate handles that lookup.
// ---------------------------------------------------------------------------

export type RetryPublishInput = {
  attemptId: string;
};

export type RetryPublishResult = {
  outcome:
    | "ok"
    | "already_retrying"
    | "not_found"
    | "invalid_state"
    | "no_connection"
    | "connection_degraded"
    | "publish_failed";
  newAttemptId?: string;
  bundlePostId?: string;
};

type ClaimRow = {
  outcome: string;
  publish_attempt_id: string | null;
  publish_job_id: string | null;
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

export async function retryPublishAttempt(
  input: RetryPublishInput,
): Promise<ApiResponse<RetryPublishResult>> {
  if (!input.attemptId) {
    return validation("attemptId is required.");
  }

  const svc = getServiceRoleClient();

  const claim = await svc.rpc("retry_publish_attempt", {
    p_attempt_id: input.attemptId,
  });
  if (claim.error) {
    logger.error("social.publish.retry.claim_failed", {
      err: claim.error.message,
      attempt_id: input.attemptId,
    });
    return internal(
      `retry_publish_attempt RPC failed: ${claim.error.message}`,
    );
  }
  const rows = (claim.data as ClaimRow[] | null) ?? [];
  const row = rows[0];
  if (!row) return internal("retry_publish_attempt returned no row.");

  if (row.outcome === "NOT_FOUND") return ok({ outcome: "not_found" });
  if (row.outcome === "INVALID_STATE") return ok({ outcome: "invalid_state" });
  if (row.outcome === "NO_CONNECTION") return ok({ outcome: "no_connection" });
  if (row.outcome === "CONNECTION_DEGRADED") {
    return ok({ outcome: "connection_degraded" });
  }
  if (row.outcome === "ALREADY_RETRYING") {
    return ok({ outcome: "already_retrying" });
  }
  if (row.outcome !== "OK") {
    return internal(`Unexpected retry outcome: ${row.outcome}`);
  }

  // bundle.social call — same shape as fire.ts.
  const client = getBundlesocialClient();
  const teamId = getBundlesocialTeamId();
  if (!client || !teamId) {
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: "platform_error",
      error_payload: { code: "RECEIVER_NOT_CONFIGURED" },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return internal("bundle.social client not configured.");
  }

  const bundlePlatform = PLATFORM_TO_BUNDLE[row.platform!];
  if (!bundlePlatform) {
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: "unknown",
      error_payload: { reason: `Unsupported platform: ${row.platform}` },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return internal(`Unsupported platform: ${row.platform}`);
  }

  const text = (row.variant_text ?? row.master_text ?? "").trim();

  // S1-22: pull media from the variant. Same shape as fire.ts.
  const variantMedia = await svc
    .from("social_post_variant")
    .select("media_asset_ids")
    .eq("id", row.post_variant_id!)
    .maybeSingle();
  if (variantMedia.error) {
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: "platform_error",
      error_payload: { reason: `media read failed: ${variantMedia.error.message}` },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return internal(`Variant media read failed: ${variantMedia.error.message}`);
  }
  const assetIds = ((variantMedia.data?.media_asset_ids as string[] | null) ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  if (!text && assetIds.length === 0) {
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: "content_rejected",
      error_payload: { reason: "Empty post body and no media" },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return internal("Post has no body text and no media.");
  }

  let uploadIds: string[] = [];
  if (assetIds.length > 0) {
    const resolved = await resolveBundleUploadIds(assetIds, row.company_id!);
    if (!resolved.ok) {
      await markAttemptFailed(svc, row.publish_attempt_id!, {
        error_class: "media_invalid",
        error_payload: { reason: resolved.error.message, asset_ids: assetIds },
      });
      await markMasterFailed(svc, row.post_master_id!);
      return ok({ outcome: "publish_failed" });
    }
    uploadIds = resolved.data.uploadIds;
  }

  const data: Record<string, unknown> = {};
  const platformBlock: Record<string, unknown> = {
    text: text || undefined,
  };
  if (uploadIds.length > 0) {
    platformBlock.uploadIds = uploadIds;
  }
  if (bundlePlatform === "LINKEDIN") {
    data.LINKEDIN = { ...platformBlock, link: row.link_url ?? undefined };
  } else if (bundlePlatform === "FACEBOOK") {
    data.FACEBOOK = { ...platformBlock, link: row.link_url ?? undefined };
  } else if (bundlePlatform === "TWITTER") {
    data.TWITTER = platformBlock;
  } else if (bundlePlatform === "GOOGLE_BUSINESS") {
    data.GOOGLE_BUSINESS = { ...platformBlock, link: row.link_url ?? undefined };
  }

  let bundlePostId: string | null = null;
  let bundleStatus: string | null = null;
  try {
    const response = (await client.post.postCreate({
      requestBody: {
        teamId,
        title: `retry:${row.publish_attempt_id}`,
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
    logger.error("social.publish.retry.bundle_post_failed", {
      err: message,
      attempt_id: row.publish_attempt_id,
    });
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: classifyError(message),
      error_payload: { message },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return ok({ outcome: "publish_failed" });
  }

  if (bundleStatus === "ERROR") {
    await markAttemptFailed(svc, row.publish_attempt_id!, {
      error_class: "platform_error",
      error_payload: { bundle_status: bundleStatus, bundle_id: bundlePostId },
    });
    await markMasterFailed(svc, row.post_master_id!);
    return ok({ outcome: "publish_failed" });
  }

  if (bundlePostId) {
    const update = await svc
      .from("social_publish_attempts")
      .update({
        bundle_post_id: bundlePostId,
        request_payload: { socialAccountTypes: [bundlePlatform], data },
        response_payload: { id: bundlePostId, status: bundleStatus },
      })
      .eq("id", row.publish_attempt_id!);
    if (update.error) {
      logger.warn("social.publish.retry.bundle_id_store_failed", {
        err: update.error.message,
        attempt_id: row.publish_attempt_id,
      });
    }
  }

  return ok({
    outcome: "ok",
    newAttemptId: row.publish_attempt_id!,
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
    logger.warn("social.publish.retry.attempt_fail_failed", {
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
    logger.warn("social.publish.retry.master_fail_failed", {
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

function ok(data: RetryPublishResult): ApiResponse<RetryPublishResult> {
  return {
    ok: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<RetryPublishResult> {
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

function internal(message: string): ApiResponse<RetryPublishResult> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action:
        "Investigate logs; the publish_attempt may be in an inconsistent state.",
    },
    timestamp: new Date().toISOString(),
  };
}
