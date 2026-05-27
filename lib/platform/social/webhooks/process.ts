import "server-only";

import { logger } from "@/lib/logger";
import { dispatch as notifyDispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import {
  AccountEventDataSchema,
  AccountUpdatedDataSchema,
  TeamUpdatedDataSchema,
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
      team_id: envelope.teamId ?? null,
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
  // social-account.updated: bundle.social treats its data as source of
  // truth — re-resolve identity from the API and upsert our row.
  if (type === "social.account.updated") {
    return handleAccountUpdated(envelope, webhookEventId, svc);
  }
  // team.updated: channel list changed (pages added/removed, etc.).
  // Re-sync the company associated with this team.
  if (type === "team.updated") {
    return handleTeamUpdated(envelope, webhookEventId, svc);
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
    // V2 fallback: check social_post_drafts.bundle_post_id. V2 posts are
    // published directly by the publish-due cron (no social_publish_attempts
    // row); the state change has already happened when the webhook arrives.
    // We just need to dispatch the post_published / post_failed notification.
    const v2draft = await svc
      .from("social_post_drafts")
      .select("id, company_id, created_by, target_profiles, published_url")
      .eq("bundle_post_id", bundlePostId)
      .maybeSingle();

    if (v2draft.error) {
      logger.warn("bundlesocial.webhook.v2_draft_lookup_failed", {
        err: v2draft.error.message,
        bundle_post_id: bundlePostId,
      });
    }

    if (v2draft.data) {
      const draftId = v2draft.data.id as string;
      const draftCompanyId = v2draft.data.company_id as string | null;
      const draftCreatedBy = v2draft.data.created_by as string | null;
      const profiles =
        (v2draft.data.target_profiles as Array<{ profile_id: string; platform: string }> | null) ?? [];
      const platform = profiles[0]?.platform ?? "unknown";

      if (type === "post.published" && draftCompanyId && draftCreatedBy) {
        void notifyDispatch({
          event: "post_published",
          companyId: draftCompanyId,
          postMasterId: draftId,
          submitterUserId: draftCreatedBy,
          platform,
          postUrl: (v2draft.data.published_url as string | null) ?? parsed.data.platformPostUrl ?? "",
        });
      } else if (type === "post.failed" && draftCompanyId && draftCreatedBy) {
        const errorClass = mapErrorClass(parsed.data.error?.class ?? null);
        void notifyDispatch({
          event: "post_failed",
          companyId: draftCompanyId,
          postMasterId: draftId,
          submitterUserId: draftCreatedBy,
          platform,
          errorClass,
          errorMessage:
            (parsed.data.error as { message?: string } | null)?.message ?? "Publish failed.",
        });
      }

      return {
        kind: "ok",
        webhookEventId,
        action: `${type === "post.published" ? "post_published" : "post_failed"}_v2`,
      };
    }

    // Common during S1-17 rollout and after V1 drain — the publish path
    // may not have run yet or the bundle_post_id is not yet stamped.
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `No publish_attempt or V2 draft for bundle_post_id=${bundlePostId}.`,
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
    .select(
      "id, company_id, status, platform, profile_id, is_personal_mode",
    )
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
    // BSP analytics: trigger a post-history import for the newly-
    // connected account. Idempotent — the active-dedup partial unique
    // index absorbs duplicate enqueues racing with the connect callback.
    if (conn.data.profile_id) {
      void triggerPostHistoryImportSafe({
        profileId: conn.data.profile_id as string,
        bundleSocialAccountId: accountId,
        platform: conn.data.platform as string,
      });
    }

    // Cross-tenant identity-leak defence (migration 0122): resolve the
    // platform-side identity now that bundle.social says the account is
    // connected. If both identity fields come back populated, flip the
    // row to 'healthy'; otherwise leave it in 'pending_identity' (the
    // existing claim_publish_job RPC's status='healthy' gate then
    // refuses publishing for incomplete-identity rows).
    //
    // We resolve identity from bundle.social by reading the connection's
    // team (via the profile or company team_id). The webhook itself
    // doesn't carry teamId — we infer from the profile row.
    let identityUpdate: {
      external_account_id: string | null;
      external_user_id: string | null;
      external_identity_hash: string | null;
      display_name: string | null;
      status: "healthy" | "pending_identity";
    } | null = null;

    if (conn.data.profile_id) {
      const profileTeam = await svc
        .from("platform_social_profiles")
        .select("bundle_social_team_id")
        .eq("id", conn.data.profile_id as string)
        .maybeSingle();
      const teamId = (profileTeam.data as { bundle_social_team_id?: string } | null)
        ?.bundle_social_team_id;
      if (teamId) {
        const {
          resolveIdentityFingerprint,
          computeIdentityHash,
          requiresChannelSelection,
        } = await import("@/lib/platform/social/connections/identity");
        const bsType = (
          envelope.data as { type?: string } | undefined
        )?.type as Parameters<typeof resolveIdentityFingerprint>[0]["platform"];
        const rawIdentity = await resolveIdentityFingerprint({
          platform: bsType,
          teamId,
        });
        const platformDb = conn.data.platform as string;
        const identity = {
          ...rawIdentity,
          external_identity_hash: computeIdentityHash(
            platformDb,
            rawIdentity.external_account_id,
            rawIdentity.external_user_id,
          ),
        };
        // Channel-selection flow (migration 0123): mirror sync.ts. The
        // row's is_personal_mode may already be true (user previously
        // opted into LinkedIn personal-mode); preserve it if so.
        // Post-877 fix (#884): mirror sync.ts — external_account_id is null
        // until setChannel is called; channels.length > 0 is not a valid
        // "channel selected" discriminator. Retain hasIdentity guard so
        // any platform with both fields null stays pending_identity.
        const hasIdentity =
          identity.external_account_id !== null ||
          identity.external_user_id !== null;
        const isPersonal = Boolean(
          (conn.data as { is_personal_mode?: boolean }).is_personal_mode,
        );
        const needsChannelSelection =
          requiresChannelSelection(bsType) &&
          identity.external_account_id === null &&
          !isPersonal;
        const status: "healthy" | "pending_identity" =
          !hasIdentity || needsChannelSelection ? "pending_identity" : "healthy";
        identityUpdate = {
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          external_identity_hash: identity.external_identity_hash,
          display_name: identity.displayName,
          status,
        };
      }
    }

    if (
      conn.data.status === "healthy" &&
      identityUpdate?.status === "healthy"
    ) {
      // Idempotent fast path — already healthy, nothing new to write.
      return { kind: "ok", webhookEventId, action: "account_connected_noop" };
    }
    const update = await svc
      .from("social_connections")
      .update({
        status: identityUpdate?.status ?? "healthy",
        last_health_check_at: now,
        last_error: null,
        ...(identityUpdate
          ? {
              external_account_id: identityUpdate.external_account_id,
              external_user_id: identityUpdate.external_user_id,
              external_identity_hash: identityUpdate.external_identity_hash,
              ...(identityUpdate.display_name !== null
                ? { display_name: identityUpdate.display_name }
                : {}),
            }
          : {}),
      })
      .eq("id", conn.data.id);
    if (update.error) {
      return {
        kind: "stored_no_action",
        webhookEventId,
        reason: `Connection healthy update failed: ${update.error.message}`,
      };
    }
    void notifyDispatch({
      event: "connection_restored",
      companyId: conn.data.company_id as string,
      platform: conn.data.platform as string,
    });
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

  // Severity mapping: disconnected = critical (publishing blocked);
  // auth_required = warning (until token refreshed).
  const severity =
    type === "social.account.disconnected" ? "critical" : "warning";
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

  void notifyDispatch({
    event: "connection_lost",
    companyId: conn.data.company_id as string,
    platform: conn.data.platform as string,
    reason: reasonText,
  });

  return {
    kind: "ok",
    webhookEventId,
    action:
      type === "social.account.disconnected"
        ? "account_disconnected"
        : "account_auth_required",
  };
}

// ---------------------------------------------------------------------------
// social-account.updated handler
//
// bundle.social is the source of truth for connection state. When this
// event fires we re-resolve the identity fingerprint from the bundle.social
// API and upsert our row so it stays in sync without waiting for the daily
// health cron.
// ---------------------------------------------------------------------------
async function handleAccountUpdated(
  envelope: WebhookEnvelope,
  webhookEventId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ProcessOutcome> {
  const parsed = AccountUpdatedDataSchema.safeParse(envelope.data ?? {});
  if (!parsed.success) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `social-account.updated data did not validate: ${parsed.error.message}`,
    };
  }
  const accountId =
    parsed.data.socialAccountId ?? parsed.data.accountId ?? null;
  if (!accountId) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "social-account.updated missing socialAccountId/accountId.",
    };
  }

  const conn = await svc
    .from("social_connections")
    .select("id, company_id, profile_id, platform, status, is_personal_mode")
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

  // Re-resolve identity from bundle.social API (source of truth).
  if (!conn.data.profile_id) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "Connection has no profile_id; cannot resolve team for identity refresh.",
    };
  }
  const profileTeam = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", conn.data.profile_id as string)
    .maybeSingle();
  const teamId = (
    profileTeam.data as { bundle_social_team_id?: string } | null
  )?.bundle_social_team_id;
  if (!teamId) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "Profile has no bundle_social_team_id; skipping identity refresh.",
    };
  }

  const {
    resolveIdentityFingerprint,
    computeIdentityHash,
    requiresChannelSelection,
  } = await import("@/lib/platform/social/connections/identity");
  // envelope.data.type carries the bundle.social platform type string.
  const bsType = (parsed.data as { type?: string }).type as Parameters<
    typeof resolveIdentityFingerprint
  >[0]["platform"];
  const rawIdentity = await resolveIdentityFingerprint({
    platform: bsType,
    teamId,
  });

  const platformDb = conn.data.platform as string;
  const identityHash = computeIdentityHash(
    platformDb,
    rawIdentity.external_account_id,
    rawIdentity.external_user_id,
  );

  const isPersonal = Boolean(
    (conn.data as { is_personal_mode?: boolean }).is_personal_mode,
  );
  const needsChannelSelection =
    requiresChannelSelection(bsType) &&
    rawIdentity.external_account_id === null &&
    !isPersonal;
  const hasIdentity =
    rawIdentity.external_account_id !== null ||
    rawIdentity.external_user_id !== null;
  const newStatus: "healthy" | "pending_identity" =
    !hasIdentity || needsChannelSelection ? "pending_identity" : "healthy";

  const now = new Date().toISOString();
  const update = await svc
    .from("social_connections")
    .update({
      status: newStatus,
      external_account_id: rawIdentity.external_account_id,
      external_user_id: rawIdentity.external_user_id,
      external_identity_hash: identityHash,
      ...(rawIdentity.displayName !== null
        ? { display_name: rawIdentity.displayName }
        : {}),
      last_health_check_at: now,
      last_error: null,
    })
    .eq("id", conn.data.id as string);

  if (update.error) {
    logger.warn("bundlesocial.webhook.account_updated_write_failed", {
      err: update.error.message,
      connection_id: conn.data.id,
    });
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Connection update failed: ${update.error.message}`,
    };
  }

  logger.info("bundlesocial.webhook.account_updated", {
    connection_id: conn.data.id,
    platform: platformDb,
    new_status: newStatus,
    had_identity_change:
      rawIdentity.external_account_id !==
      (conn.data as { external_account_id?: string | null }).external_account_id,
  });

  return { kind: "ok", webhookEventId, action: "account_updated" };
}

// ---------------------------------------------------------------------------
// team.updated handler
//
// Fires when channel state changes (pages added/removed, etc.) per
// bundle.social. Re-sync the company linked to this team so our DB
// reflects the current channel roster.
// ---------------------------------------------------------------------------
async function handleTeamUpdated(
  envelope: WebhookEnvelope,
  webhookEventId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<ProcessOutcome> {
  const parsed = TeamUpdatedDataSchema.safeParse(envelope.data ?? {});
  if (!parsed.success) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `team.updated data did not validate: ${parsed.error.message}`,
    };
  }

  // teamId is on the envelope envelope; also accept it from the payload.
  const teamId = envelope.teamId ?? parsed.data.teamId ?? null;
  if (!teamId) {
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: "team.updated missing teamId in envelope and data.",
    };
  }

  // Find the company associated with this bundle.social team.
  const profile = await svc
    .from("platform_social_profiles")
    .select("company_id")
    .eq("bundle_social_team_id", teamId)
    .limit(1)
    .maybeSingle();
  if (profile.error || !profile.data) {
    logger.info("bundlesocial.webhook.team_updated_no_company", {
      team_id: teamId,
      err: profile.error?.message,
    });
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `No platform_social_profiles row for bundle_social_team_id=${teamId}.`,
    };
  }
  const companyId = profile.data.company_id as string;

  const { syncBundlesocialConnections } = await import(
    "@/lib/platform/social/connections"
  );
  const syncResult = await syncBundlesocialConnections({
    companyId,
    // No attribution — this is a state-refresh, not a new-connection flow.
  });

  if (!syncResult.ok) {
    logger.warn("bundlesocial.webhook.team_updated_sync_failed", {
      team_id: teamId,
      company_id: companyId,
      code: syncResult.error.code,
    });
    return {
      kind: "stored_no_action",
      webhookEventId,
      reason: `Sync failed for company ${companyId}: ${syncResult.error.code}`,
    };
  }

  logger.info("bundlesocial.webhook.team_updated_synced", {
    team_id: teamId,
    company_id: companyId,
    inserted: syncResult.data.inserted,
    updated: syncResult.data.updated,
    marked_disconnected: syncResult.data.marked_disconnected,
  });

  return { kind: "ok", webhookEventId, action: "team_updated_synced" };
}

// BSP analytics — fire-and-forget post-history import trigger.
//
// Called when a social.account.connected webhook arrives. Idempotent at
// the row level via the active-dedup partial unique index in migration
// 0121, so the call is safe to race with the connect-callback enqueue.
//
// Errors are swallowed and logged — failing to start the post-history
// import must NOT cause the webhook to retry (the connection itself is
// already healthy; the import is a side effect the daily cron will
// eventually pick up via the snapshot refresh anyway).
async function triggerPostHistoryImportSafe(args: {
  profileId: string;
  bundleSocialAccountId: string;
  platform: string;
}): Promise<void> {
  try {
    const { enqueuePostHistoryImport } = await import(
      "@/lib/platform/social/analytics-ingest"
    );
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
      "http://localhost:3000";
    await enqueuePostHistoryImport({
      profileId: args.profileId,
      bundleSocialAccountId: args.bundleSocialAccountId,
      // platform is a SocialPlatform-shaped string at this point; the
      // enqueue helper narrows internally and skips unsupported values.
      platform: args.platform as never,
      origin,
    });
  } catch (err) {
    logger.warn("bundlesocial.webhook.post_history_import_trigger_failed", {
      err: err instanceof Error ? err.message : String(err),
      profile_id: args.profileId,
      bundle_social_account_id: args.bundleSocialAccountId,
    });
  }
}
