import "server-only";

import { logger } from "@/lib/logger";
import { dispatch } from "@/lib/platform/notifications";
import { getQstashClient } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";

import type { Invitation } from "./types";

// ---------------------------------------------------------------------------
// P2-4 — invitation reminder + expiry callbacks.
//
// QStash publishes a delayed POST to our webhook routes 3 days and 14
// days after invitation creation. Each handler:
//   1. Looks up the invitation by id.
//   2. Returns "no-op" if the invitation is not pending OR the
//      side-effect column (reminder_sent_at / expired_notified_at) is
//      already populated. Both rules together make duplicate webhook
//      fires idempotent — QStash retries on non-2xx, so handlers MUST
//      be safe to call repeatedly.
//   3. For expiry: atomically transitions status pending → expired
//      using `UPDATE ... WHERE status='pending'`. Two concurrent
//      callback fires both UPDATE; the second affects 0 rows, so only
//      one notification is dispatched.
//   4. For reminder: atomically sets reminder_sent_at using
//      `UPDATE ... WHERE reminder_sent_at IS NULL`. Same race-safe
//      pattern.
//   5. Calls dispatch() AFTER the atomic update returned a row, so the
//      "I won the race" branch is the only one that emails.
//
// Why store the side-effect timestamps on the invitation row rather
// than dedup via a separate webhook-event table? platform_invitations
// already has reminder_sent_at + expired_notified_at columns, and the
// rate of fires is low enough that no separate table is justified.
// social_webhook_events (for bundle.social) is the right pattern when
// many webhook types share an idempotency anchor — invitation
// callbacks are 2 events per invitation max.
// ---------------------------------------------------------------------------

export type CallbackResult = {
  // What the handler did. Lets the route handler log + the test
  // assert without inspecting DB state.
  outcome:
    | "noop_already_handled"
    | "noop_not_pending"
    | "noop_not_found"
    | "dispatched"
    | "internal_error";
  invitationId: string;
  message?: string;
};

const ACCEPT_PATH = "/invite";

function buildAcceptUrl(rawTokenPlaceholder: string | null): string {
  // Reminder path: we don't have the raw token at callback time (only
  // the hash is stored). The reminder email links to the magic-link
  // page with the same hash-bound flow — the recipient gets the
  // accept URL that the original invitation_sent email already
  // delivered, just nudged again with a "expires soon" lead.
  //
  // Implementation: we pass the original raw token through QStash's
  // body so the reminder email can re-link to /invite/<token>.
  // This callback handler accepts the token via parameter; if the
  // caller doesn't pass one, we fall back to the platform's pending-
  // invitations admin page so the user can request a fresh link.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (rawTokenPlaceholder) {
    return `${origin}${ACCEPT_PATH}/${rawTokenPlaceholder}`;
  }
  return `${origin}/invite-help`;
}

export async function handleReminderCallback(args: {
  invitationId: string;
  // QStash's delayed publish carries the raw token in the body so the
  // reminder email can re-link to the same accept URL. Optional —
  // an absent token degrades to a fallback URL.
  rawToken?: string;
}): Promise<CallbackResult> {
  const svc = getServiceRoleClient();

  const lookup = await svc
    .from("platform_invitations")
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .eq("id", args.invitationId)
    .maybeSingle();

  if (lookup.error) {
    logger.error("invitations.callback.reminder.lookup_failed", {
      invitation_id: args.invitationId,
      err: lookup.error.message,
    });
    return {
      outcome: "internal_error",
      invitationId: args.invitationId,
      message: lookup.error.message,
    };
  }

  if (!lookup.data) {
    return { outcome: "noop_not_found", invitationId: args.invitationId };
  }

  const invitation = lookup.data as Invitation;

  if (invitation.status !== "pending") {
    return {
      outcome: "noop_not_pending",
      invitationId: args.invitationId,
      message: `status=${invitation.status}`,
    };
  }

  if (invitation.reminder_sent_at) {
    return {
      outcome: "noop_already_handled",
      invitationId: args.invitationId,
    };
  }

  // Atomic mark-as-sent. WHERE clause makes concurrent fires safe:
  // only one UPDATE returns a row.
  const claim = await svc
    .from("platform_invitations")
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq("id", args.invitationId)
    .is("reminder_sent_at", null)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claim.error) {
    logger.error("invitations.callback.reminder.claim_failed", {
      invitation_id: args.invitationId,
      err: claim.error.message,
    });
    return {
      outcome: "internal_error",
      invitationId: args.invitationId,
      message: claim.error.message,
    };
  }

  if (!claim.data) {
    // Another fire claimed it first.
    return {
      outcome: "noop_already_handled",
      invitationId: args.invitationId,
    };
  }

  const acceptUrl = buildAcceptUrl(args.rawToken ?? null);

  const dispatchResult = await dispatch({
    event: "invitation_reminder",
    companyId: invitation.company_id,
    inviteeEmail: invitation.email,
    acceptUrl,
    expiresAt: invitation.expires_at,
  });

  if (dispatchResult.errors.length > 0) {
    logger.warn("invitations.callback.reminder.dispatch_partial_failure", {
      invitation_id: args.invitationId,
      errors: dispatchResult.errors,
    });
  }

  return { outcome: "dispatched", invitationId: args.invitationId };
}

export async function handleExpiryCallback(args: {
  invitationId: string;
}): Promise<CallbackResult> {
  const svc = getServiceRoleClient();

  const lookup = await svc
    .from("platform_invitations")
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .eq("id", args.invitationId)
    .maybeSingle();

  if (lookup.error) {
    logger.error("invitations.callback.expiry.lookup_failed", {
      invitation_id: args.invitationId,
      err: lookup.error.message,
    });
    return {
      outcome: "internal_error",
      invitationId: args.invitationId,
      message: lookup.error.message,
    };
  }

  if (!lookup.data) {
    return { outcome: "noop_not_found", invitationId: args.invitationId };
  }

  const invitation = lookup.data as Invitation;

  // Idempotency anchor first: expired_notified_at is only set by a
  // previous successful expiry fire (which also flips status to
  // 'expired'). Checking it before the status gate gives a precise
  // "duplicate fire" signal rather than the looser noop_not_pending
  // we'd return otherwise.
  if (invitation.expired_notified_at) {
    return {
      outcome: "noop_already_handled",
      invitationId: args.invitationId,
    };
  }

  if (invitation.status !== "pending") {
    return {
      outcome: "noop_not_pending",
      invitationId: args.invitationId,
      message: `status=${invitation.status}`,
    };
  }

  // Atomic transition: pending → expired + stamp expired_notified_at.
  // Concurrent fires: only one UPDATE affects a row.
  const claim = await svc
    .from("platform_invitations")
    .update({
      status: "expired",
      expired_notified_at: new Date().toISOString(),
    })
    .eq("id", args.invitationId)
    .eq("status", "pending")
    .is("expired_notified_at", null)
    .select("id, company_id, email, invited_by")
    .maybeSingle();

  if (claim.error) {
    logger.error("invitations.callback.expiry.claim_failed", {
      invitation_id: args.invitationId,
      err: claim.error.message,
    });
    return {
      outcome: "internal_error",
      invitationId: args.invitationId,
      message: claim.error.message,
    };
  }

  if (!claim.data) {
    return {
      outcome: "noop_already_handled",
      invitationId: args.invitationId,
    };
  }

  const dispatchResult = await dispatch({
    event: "invitation_expired",
    companyId: invitation.company_id,
    inviteeEmail: invitation.email,
    inviterUserId: invitation.invited_by,
  });

  if (dispatchResult.errors.length > 0) {
    logger.warn("invitations.callback.expiry.dispatch_partial_failure", {
      invitation_id: args.invitationId,
      errors: dispatchResult.errors,
    });
  }

  return { outcome: "dispatched", invitationId: args.invitationId };
}

// ---------------------------------------------------------------------------
// Enqueueing — called from the invitation send route after a successful
// insert. Enqueues two delayed messages on QStash:
//   1. Reminder at +3 days, body { invitationId, rawToken }
//   2. Expiry at expires_at - now() (default ~14 days),
//      body { invitationId }
//
// QStash failures are logged but do NOT fail the parent request — the
// invitation row is already created and the immediate invitation_sent
// email has already been delivered. Missing callbacks degrade UX
// (no reminder + no auto-expiry mark) but don't break correctness.
//
// When QSTASH_TOKEN is unset (local dev / staging without provisioning),
// this function logs and returns { reminder: null, expiry: null } so
// the caller's happy path stays the same.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DELAY_DAYS = 3;

export type EnqueueResult = {
  reminderMessageId: string | null;
  expiryMessageId: string | null;
};

export async function enqueueInvitationCallbacks(args: {
  invitationId: string;
  rawToken: string;
  expiresAt: string;
  origin: string;
}): Promise<EnqueueResult> {
  const client = getQstashClient();
  if (!client) {
    logger.info("invitations.enqueue.skipped_no_qstash", {
      invitation_id: args.invitationId,
    });
    return { reminderMessageId: null, expiryMessageId: null };
  }

  const baseUrl = args.origin.replace(/\/+$/, "");
  const reminderUrl = `${baseUrl}/api/platform/invitations/callbacks/reminder`;
  const expiryUrl = `${baseUrl}/api/platform/invitations/callbacks/expiry`;

  const now = Date.now();
  const reminderDelaySeconds = Math.max(
    1,
    Math.floor((REMINDER_DELAY_DAYS * DAY_MS) / 1000),
  );
  const expiryDelaySeconds = Math.max(
    1,
    Math.floor((new Date(args.expiresAt).getTime() - now) / 1000),
  );

  // Run both publishes in parallel; an error on one shouldn't block
  // the other from being scheduled.
  const [reminder, expiry] = await Promise.allSettled([
    client.publishJSON({
      url: reminderUrl,
      body: { invitationId: args.invitationId, rawToken: args.rawToken },
      delay: reminderDelaySeconds,
      // deduplicationId scopes against re-fires of the same logical
      // event — protects against a duplicate enqueue if the route
      // handler retries.
      deduplicationId: `invitation-reminder-${args.invitationId}`,
    }),
    client.publishJSON({
      url: expiryUrl,
      body: { invitationId: args.invitationId },
      delay: expiryDelaySeconds,
      deduplicationId: `invitation-expiry-${args.invitationId}`,
    }),
  ]);

  let reminderId: string | null = null;
  let expiryId: string | null = null;

  if (reminder.status === "fulfilled") {
    reminderId =
      (reminder.value as { messageId?: string }).messageId ?? null;
  } else {
    logger.error("invitations.enqueue.reminder_failed", {
      invitation_id: args.invitationId,
      err:
        reminder.reason instanceof Error
          ? reminder.reason.message
          : String(reminder.reason),
    });
  }

  if (expiry.status === "fulfilled") {
    expiryId = (expiry.value as { messageId?: string }).messageId ?? null;
  } else {
    logger.error("invitations.enqueue.expiry_failed", {
      invitation_id: args.invitationId,
      err:
        expiry.reason instanceof Error
          ? expiry.reason.message
          : String(expiry.reason),
    });
  }

  return { reminderMessageId: reminderId, expiryMessageId: expiryId };
}
