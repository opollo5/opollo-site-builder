import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { defaultExpiry, generateRawToken, hashToken } from "./tokens";
import type {
  Invitation,
  SendInvitationInput,
  SendInvitationResult,
} from "./types";

// Creates a platform_invitations row. Validates the V1 invariants the
// schema cannot express on its own:
//   1. Email isn't already a member of ANY company (V1: one user, one
//      company — UNIQUE (user_id) on platform_company_users would catch
//      this on accept, but better to fail loud at invite time so the
//      sender sees a clear error before the recipient gets confused).
//   2. No active pending invitation already exists for (company_id,
//      email). The partial UNIQUE index `idx_invitations_unique_pending`
//      enforces this at the schema layer; we surface a friendly code
//      instead of letting the 23505 bubble up.
//
// On success: returns the inserted row + the raw token. Caller (the
// route handler) sends the email; this lib does NOT touch SendGrid so
// it stays testable without network mocks.
//
// On email-send failure (caller's concern): the row is already inserted
// with status='pending'. Operator can resend manually by revoking +
// re-inviting. Future P2-3 reminder system will also retry the email
// at day 3 if accepted_at is still null.

export async function sendInvitation(
  input: SendInvitationInput,
): Promise<SendInvitationResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "A valid email address is required.",
      },
    };
  }

  const svc = getServiceRoleClient();

  // 1. Reject if a platform user with this email is already a member of
  // any company (V1: one user, one company).
  const memberCheck = await svc
    .from("platform_users")
    .select("id, platform_company_users(company_id)")
    .eq("email", email)
    .maybeSingle();
  if (memberCheck.error) {
    logger.error("invitations.send.member_lookup_failed", {
      err: memberCheck.error.message,
    });
    return internal(`Member lookup failed: ${memberCheck.error.message}`);
  }
  if (
    memberCheck.data &&
    Array.isArray(memberCheck.data.platform_company_users) &&
    memberCheck.data.platform_company_users.length > 0
  ) {
    return {
      ok: false,
      error: {
        code: "ACTIVE_MEMBERSHIP_EXISTS",
        message:
          "This email is already a member of a company on the platform.",
      },
    };
  }

  // 2. Reject if a pending invitation already exists for this
  // (company_id, email). The schema-level partial UNIQUE will also
  // enforce this — pre-checking gives a friendlier code path.
  const pendingCheck = await svc
    .from("platform_invitations")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();
  if (pendingCheck.error) {
    logger.error("invitations.send.pending_lookup_failed", {
      err: pendingCheck.error.message,
    });
    return internal(`Pending lookup failed: ${pendingCheck.error.message}`);
  }
  if (pendingCheck.data) {
    return {
      ok: false,
      error: {
        code: "PENDING_INVITE_EXISTS",
        message:
          "A pending invitation already exists for this email in this company. Revoke it first or wait for it to expire.",
      },
    };
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = input.expiresAt ?? defaultExpiry();

  const insertResult = await svc
    .from("platform_invitations")
    .insert({
      company_id: input.companyId,
      email,
      role: input.role,
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
      invited_by: input.invitedBy,
    })
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .single();

  if (insertResult.error) {
    // 23505 indicates the partial UNIQUE index fired between our pre-check
    // and the insert (race). Treat as PENDING_INVITE_EXISTS.
    if (insertResult.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "PENDING_INVITE_EXISTS",
          message:
            "A pending invitation was created concurrently for this email.",
        },
      };
    }
    logger.error("invitations.send.insert_failed", {
      err: insertResult.error.message,
      code: insertResult.error.code,
    });
    return internal(`Insert failed: ${insertResult.error.message}`);
  }

  return {
    ok: true,
    invitation: insertResult.data as Invitation,
    rawToken,
  };
}

function internal(message: string): SendInvitationResult {
  return { ok: false, error: { code: "INTERNAL_ERROR", message } };
}
