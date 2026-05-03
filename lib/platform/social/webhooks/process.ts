import "server-only";

import { logger } from "@/lib/logger";
import { dispatch as notifyDispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import {
  AccountEventDataSchema,
  mapErrorClass,
  PostEventDataSchema,
  type WebhookEnvelope,
} from "./types";

// ---------------------------------------------------------------------------
// S1-17 — process a verified bundle.social webhook event.
//
// Two responsibilities, in order:
//   1. Insert into social_webhook_events with idempotency keyed on
//      bundle.social's `id`. Duplicate deliveries (bundle.social retries
//      on 5xx) are absorbed at the unique constraint and short-circuit
//      to outcome='already_processed'.
//   2. Dispatch on `type`:
//        - post.published / post.failed: update social_publish_attempts
//          (and the variant's post_master.state) for the matching
//          bundle_post_id. Unknown bundle_post_id → log + skip
//          (publish-side may not have run yet during S1-17 rollout).
//        - social-account.disconnected / .auth-required: flip the
//          connection's status + insert a connection_alert.
//        - anything else: stored, no side-effect.
//
// Every successful path ends with social_webhook_events.processed_at
// stamped so the next replay short-circuits.
//
// All errors are caught and returned as outcome='internal_error' so
// the caller can decide whether to surface 500 (and bundle.social
// retries) or 200 (and the audit row stays unprocessed for a manual
// replay). V1: we surface 500 only for the `idempotent_insert_failed`
// branch (DB unreachable); processing failures get 200 + an unprocessed
// audit row that ops can replay.
// ---------------------------------------------------------------------------

export type ProcessOutcome =
  | { kind: "ok"; webhookEventId: string; action: string }
  | { kind: "already_processed"; webhookEventId: string }
  | { kind: "stored_no_action"; webhookEventId: string; reason: string }
  | { kind: "idempotent_insert_failed"; message: string }
  | { kind: "validation_failed"; message: string };

export async function processBundlesocialWebhook(input: {
  envelope: WebhookEnvelope;
  rawPayload: unknown;
  signatureValid: boolean;
}): Promise<ProcessOutcome> {
  const svc = getServiceRoleClient();
  const { envelope, rawPayload, signatureValid } = input;

  const insert = await svc
    .from("social_webhook_events")
    .insert({
      event_id: envelope.id,
      event_type: envelope.type,
      raw_payload: rawPayload as Record<string, unknown>,
      signature_valid: signatureValid,
    })
    .select("id, processed_at")
    .single();

  let webhookEventId: string;
  if (insert.error) {
    if (insert.error.code === "23505") {
      const existing = await svc
        .from("social_webhook_events")
        .select("id, processed_at")
        .eq("event_id", envelope.id)
        .single();
      if (existing.error || !existing.data) {
        logger.error("bundlesocial.webhook.dup_lookup_failed", {
          err: existing.error?.message,
          event_id: envelope.id,
        });
        return {
          kind: "idempotent_insert_failed",
          message: `Duplicate event lookup failed: ${existing.error?.message ?? "row missing"}`,
        };
      }
      if (existing.data.processed_at) {
        return {
          kind: "already_processed",
          webhookEventId: existing.data.id as string,
        };
      }
      webhookEventId = existing.data.id as string;
    } else {
      logger.error("bundlesocial.webhook.insert_failed", {
        err: insert.error.message,
        code: insert.error.code,
        event_id: envelope.id,
      });
      return {
        kind: "idempotent_insert_failed",
        message: insert.error.message,
      };
    }
  } else {
    webhookEventId = insert.data.id as string;
  }

  const action = await dispatch(envelope, webhookEventId, svc);

  if (action.kind === "ok" || action.kind === "stored_no_action") {
    const stamp = await svc
      .from("social_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", webhookEventId);
    if (stamp.error) {
      logger.warn("bundlesocial.webhook.processed_stamp_failed", {
        err: stamp.error.message,
        webhook_event_id: webhookEventId,
      });
    }
  }

  return action;
}

async function dispatch(
  envelope: WebhookEnvelope,
  webhookEventId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ProcessOutcome> {
  // Normalise type by collapsing case + replacing dashes/underscores
  // with dots so bundle.social's mixed conventions
  // ("social-account.disconnected" vs "social_account.disconnected")
  // all hit the same handler.
  const type = envelope.type.toLowerCase().replace(/[-_]/g, ".");

  if (type === "post.published" || type === "post.failed") {
    return handlePostEvent(envelope, type, webhookEventId, svc);
  }
  if (
    type === "social.account.disconnected" ||
    type === "social.account.auth.required" ||
    type === "social.account.connected"
  ) {
    return handleAccountEvent(envelope, type, webhookEventId, svc);
  }

  return {
    kind: "stored_no_action",
    webhookEventId,
    reason: `Unhandled event type: ${envelope.type}`,
  };
}

async function handlePostEvent(
  envelope: WebhookEnvelope,
  type: "post.published" | "post.failed",
  webhookEventId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ProcessOutcome> {
  const parsed = PostEventDataSchema.safeParse(envelope.data ?? {});
  if (!parsed.success) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Post event data did not validate: ${parsed.error.message}`,
    };
  }
  const bundlePostId = parsed.data.bundlePostId ?? parsed.data.postId ?? null;
  if (!bundlePostId) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "Post event missing bundlePostId/postId.",
    };
  }

  const attempt = await svc
    .from("social_publish_attempts")
    .select("id, post_variant_id, status")
    .eq("bundle_post_id", bundlePostId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (attempt.error) {
    logger.warn("bundlesocial.webhook.attempt_lookup_failed", {
      err: attempt.error.message,
      bundle_post_id: bundlePostId,
    });
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Attempt lookup failed: ${attempt.error.message}`,
    };
  }
  if (!attempt.data) {
    // Common during S1-17 rollout — the publish path (S1-18+) hasn't
    // run yet so there's no attempt row. Audit the event and move on.
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `No publish_attempt for bundle_post_id=${bundlePostId}.`,
    };
  }

  const now = new Date().toISOString();
  const variantLookup = await svc
    .from("social_post_variant")
    .select("post_master_id, platform")
    .eq("id", attempt.data.post_variant_id)
    .maybeSingle();
  const masterId =
    (variantLookup.data?.post_master_id as string | undefined) ??
    "00000000-0000-0000-0000-000000000000";
  const variantPlatform = (variantLookup.data?.platform as string | undefined) ?? "";

  // Resolve master metadata for notification dispatch.
  const masterMeta = await svc
    .from("social_post_master")
    .select("company_id, created_by")
    .eq("id", masterId)
    .maybeSingle();
  const notifCompanyId = (masterMeta.data?.company_id as string | undefined) ?? "";
  const notifSubmitter = (masterMeta.data?.created_by as string | undefined) ?? "";

  if (type === "post.published") {
    const update = await svc
      .from("social_publish_attempts")
      .update({
        status: "succeeded",
        platform_post_url: parsed.data.platformPostUrl ?? null,
        completed_at: now,
        response_payload: envelope.data ?? null,
      })
      .eq("id", attempt.data.id);
    if (update.error) {
      logger.warn("bundlesocial.webhook.attempt_update_failed", {
        err: update.error.message,
        attempt_id: attempt.data.id,
      });
      return {
        kind: "stored_no_action",
        webhookEventId,
        reason: `Attempt update failed: ${update.error.message}`,
      };
    }

    // Predicate-guarded transition; duplicate webhooks are safe.
    const masterUpdate = await svc
      .from("social_post_master")
      .update({ state: "published" })
      .eq("id", masterId)
      .in("state", ["publishing", "scheduled"]);
    if (masterUpdate.error) {
      logger.warn("bundlesocial.webhook.master_publish_failed", {
        err: masterUpdate.error.message,
      });
    }

    if (notifCompanyId && notifSubmitter && variantPlatform) {
      void notifyDispatch({
        event: "post_published",
        companyId: notifCompanyId,
        postMasterId: masterId,
        submitterUserId: notifSubmitter,
        platform: variantPlatform,
        postUrl: parsed.data.platformPostUrl ?? "",
      });
    }

    return { kind: "ok", webhookEventId, action: "post_published" };
  }

  // post.failed
  const errorClass = mapErrorClass(parsed.data.error?.class ?? null);
  const update = await svc
    .from("social_publish_attempts")
    .update({
      status: "failed",
      error_class: errorClass,
      error_payload: parsed.data.error ?? envelope.data ?? null,
      completed_at: now,
      response_payload: envelope.data ?? null,
    })
    .eq("id", attempt.data.id);
  if (update.error) {
    logger.warn("bundlesocial.webhook.attempt_fail_update_failed", {
      err: update.error.message,
      attempt_id: attempt.data.id,
    });
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Attempt update failed: ${update.error.message}`,
    };
  }

  const masterUpdate = await svc
    .from("social_post_master")
    .update({ state: "failed" })
    .eq("id", masterId)
    .in("state", ["publishing", "scheduled"]);
  if (masterUpdate.error) {
    logger.warn("bundlesocial.webhook.master_fail_failed", {
      err: masterUpdate.error.message,
    });
  }

  if (notifCompanyId && notifSubmitter && variantPlatform) {
    void notifyDispatch({
      event: "post_failed",
      companyId: notifCompanyId,
      postMasterId: masterId,
      submitterUserId: notifSubmitter,
      platform: variantPlatform,
      errorClass,
      errorMessage: (parsed.data.error as { message?: string } | null)?.message ?? "Publish failed.",
    });
  }

  return { kind: "ok", webhookEventId, action: "post_failed" };
}

async function handleAccountEvent(
  envelope: WebhookEnvelope,
  type:
    | "social.account.disconnected"
    | "social.account.auth.required"
    | "social.account.connected",
  webhookEventId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ProcessOutcome> {
  const parsed = AccountEventDataSchema.safeParse(envelope.data ?? {});
  if (!parsed.success) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Account event data did not validate: ${parsed.error.message}`,
    };
  }
  const accountId =
    parsed.data.socialAccountId ?? parsed.data.accountId ?? null;
  if (!accountId) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "Account event missing socialAccountId/accountId.",
    };
  }

  const conn = await svc
    .from("social_connections")
    .select("id, company_id, status")
    .eq("bundle_social_account_id", accountId)
    .maybeSingle();
  if (conn.error) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Connection lookup failed: ${conn.error.message}`,
    };
  }
  if (!conn.data) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `No social_connections row for bundle_social_account_id=${accountId}.`,
    };
  }

  const now = new Date().toISOString();

  if (type === "social.account.connected") {
    if (conn.data.status === "healthy") {
      return { kind: "ok", webhookEventId, action: "account_connected_noop" };
    }
    const update = await svc
      .from("social_connections")
      .update({
        status: "healthy",
        last_health_check_at: now,
        last_error: null,
      })
      .eq("id", conn.data.id);
    if (update.error) {
      return {
        kind: "stored_no_action",
        webhookEventId,
        reason: `Connection healthy update failed: ${update.error.message}`,
      };
    }
    return { kind: "ok", webhookEventId, action: "account_connected" };
  }

  const newStatus =
    type === "social.account.disconnected" ? "disconnected" : "auth_required";
  const reasonText =
    parsed.data.reason ??
    (type === "social.account.disconnected"
      ? "Disconnected at platform"
      : "Re-authentication required");

  const update = await svc
    .from("social_connections")
    .update({
      status: newStatus,
      last_health_check_at: now,
      last_error: reasonText,
      ...(type === "social.account.disconnected"
        ? { disconnected_at: now }
        : {}),
    })
    .eq("id", conn.data.id);
  if (update.error) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Connection ${newStatus} update failed: ${update.error.message}`,
    };
  }

  // Severity mapping: disconnected = error (publishing blocked);
  // auth_required = warning (until token refreshed).
  const severity =
    type === "social.account.disconnected" ? "error" : "warning";
  const alert = await svc.from("social_connection_alerts").insert({
    connection_id: conn.data.id,
    company_id: conn.data.company_id,
    severity,
    message: reasonText,
  });
  if (alert.error) {
    logger.warn("bundlesocial.webhook.alert_insert_failed", {
      err: alert.error.message,
      connection_id: conn.data.id,
    });
  }

  return {
    kind: "ok",
    webhookEventId,
    action:
      type === "social.account.disconnected"
        ? "account_disconnected"
        : "account_auth_required",
  };
}
