import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { hashToken } from "./tokens";
import type {
  AcceptInvitationInput,
  AcceptInvitationResult,
  Invitation,
} from "./types";

// ---------------------------------------------------------------------------
// Accept-flow lib helper.
//
// Validates the raw token, creates the auth.users row, then writes the
// platform_users + platform_company_users rows in lockstep, then marks the
// invitation accepted. The auth.admin.createUser call is unavoidably
// outside the Postgres transaction — Supabase Auth is a separate service.
// On partial failure (auth user created, follow-up DB writes failed) we
// log loudly and surface INTERNAL_ERROR so an operator can investigate.
// The orphaned auth.users row can complete sign-up via password reset.
//
// Validation order is deliberate:
//   1. Token resolves → INVALID_TOKEN if not.
//   2. Status checks → REVOKED / ALREADY_ACCEPTED before EXPIRED, since
//      the user-actionable error is more useful than "you waited too long
//      to accept a revoked invite."
//   3. expires_at vs now() → EXPIRED.
//   4. Email matches (case-insensitive) → EMAIL_MISMATCH.
//   5. Auth user creation → AUTH_USER_EXISTS if Supabase 422s on duplicate.
//   6. platform_users + platform_company_users + invitation update.
//
// The route handler is responsible for password-strength enforcement; this
// lib trusts the password it's given (Supabase Auth has its own minimum
// length policy that will reject too-short passwords with a clear error).

export async function acceptInvitation(
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const trimmedEmail = input.email.trim().toLowerCase();
  if (!trimmedEmail || !trimmedEmail.includes("@")) {
    return validation("Email is required.");
  }
  if (!input.fullName.trim()) {
    return validation("Full name is required.");
  }
  if (!input.rawToken || input.rawToken.length < 32) {
    return validation("Token is required.");
  }
  if (!input.password || input.password.length < 8) {
    return validation("Password must be at least 8 characters.");
  }

  const tokenHash = hashToken(input.rawToken);
  const svc = getServiceRoleClient();

  // 1. Resolve invitation by hash.
  const lookupResult = await svc
    .from("platform_invitations")
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (lookupResult.error) {
    logger.error("invitations.accept.lookup_failed", {
      err: lookupResult.error.message,
    });
    return internal(`Lookup failed: ${lookupResult.error.message}`);
  }
  if (!lookupResult.data) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Token not found. Ask for a fresh invitation.",
      },
    };
  }
  const invitation = lookupResult.data as Invitation;

  // 2. Status checks (revoked / already-accepted are user-actionable;
  //    surface them before the expiry check).
  if (invitation.status === "revoked" || invitation.revoked_at) {
    return {
      ok: false,
      error: {
        code: "REVOKED",
        message: "This invitation was revoked. Ask for a new one.",
      },
    };
  }
  if (invitation.status === "accepted" || invitation.accepted_at) {
    return {
      ok: false,
      error: {
        code: "ALREADY_ACCEPTED",
        message: "This invitation has already been accepted. Sign in instead.",
      },
    };
  }

  // 3. Expiry.
  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      error: {
        code: "EXPIRED",
        message: "This invitation has expired. Ask for a new one.",
      },
    };
  }

  // 4. Email match (case-insensitive). The invitation's email was
  // normalised to lowercase on insert; compare normalised input.
  if (invitation.email !== trimmedEmail) {
    return {
      ok: false,
      error: {
        code: "EMAIL_MISMATCH",
        message:
          "Email does not match the address this invitation was sent to.",
      },
    };
  }

  // 5. Create auth.users via the admin API. email_confirm:true skips
  // Supabase's confirmation flow — the magic link itself is the proof of
  // email ownership. Future security hardening could add a second-factor
  // step here per the platform-customer-management skill.
  const createResult = await svc.auth.admin.createUser({
    email: trimmedEmail,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() },
  });
  if (createResult.error || !createResult.data?.user) {
    const status = (createResult.error as { status?: number } | null)?.status;
    if (
      status === 422 ||
      /already (registered|exists)/i.test(createResult.error?.message ?? "")
    ) {
      return {
        ok: false,
        error: {
          code: "AUTH_USER_EXISTS",
          message:
            "An account already exists for this email. Sign in instead, or use 'Forgot password'.",
        },
      };
    }
    logger.error("invitations.accept.create_user_failed", {
      err: createResult.error?.message,
    });
    return internal(
      `Auth user creation failed: ${createResult.error?.message ?? "unknown"}`,
    );
  }
  const userId = createResult.data.user.id;

  // 6. platform_users + platform_company_users + mark accepted.
  // From this point onwards a partial failure leaves an orphan auth.users
  // row that can recover via password reset (the user is in auth.users
  // with a valid password, just not yet in platform_users). Logged
  // explicitly so an operator can clean up if needed.

  const userInsert = await svc
    .from("platform_users")
    .insert({
      id: userId,
      email: trimmedEmail,
      full_name: input.fullName.trim(),
      is_opollo_staff: false,
    })
    .select("id")
    .single();
  if (userInsert.error) {
    logger.error("invitations.accept.platform_user_insert_failed", {
      auth_user_id: userId,
      err: userInsert.error.message,
      partial_failure: true,
      recovery: "password reset",
    });
    return internal(
      `platform_users insert failed: ${userInsert.error.message}`,
    );
  }

  const membershipInsert = await svc
    .from("platform_company_users")
    .insert({
      company_id: invitation.company_id,
      user_id: userId,
      role: invitation.role,
      added_by: invitation.invited_by,
    })
    .select("id")
    .single();
  if (membershipInsert.error) {
    logger.error("invitations.accept.membership_insert_failed", {
      auth_user_id: userId,
      company_id: invitation.company_id,
      err: membershipInsert.error.message,
      partial_failure: true,
      recovery: "manual platform_company_users insert by Opollo staff",
    });
    return internal(
      `platform_company_users insert failed: ${membershipInsert.error.message}`,
    );
  }

  const acceptUpdate = await svc
    .from("platform_invitations")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_user_id: userId,
    })
    .eq("id", invitation.id);
  if (acceptUpdate.error) {
    logger.error("invitations.accept.mark_accepted_failed", {
      invitation_id: invitation.id,
      auth_user_id: userId,
      err: acceptUpdate.error.message,
      partial_failure: true,
      recovery:
        "user is fully provisioned; invitation row will eventually expire naturally",
    });
    // The user is fully provisioned — fail soft on the invitation update.
    // Returning ok:true would leave the invitation in 'pending' state with
    // a non-null accepted_user_id mismatch; better to surface the error
    // and let the operator clean up the row, while the user still has
    // their account (the auth + platform inserts succeeded).
    return internal(
      `Mark-accepted update failed: ${acceptUpdate.error.message}`,
    );
  }

  return {
    ok: true,
    userId,
    companyId: invitation.company_id,
    role: invitation.role,
  };
}

function validation(message: string): AcceptInvitationResult {
  return { ok: false, error: { code: "VALIDATION_FAILED", message } };
}

function internal(message: string): AcceptInvitationResult {
  return { ok: false, error: { code: "INTERNAL_ERROR", message } };
}
