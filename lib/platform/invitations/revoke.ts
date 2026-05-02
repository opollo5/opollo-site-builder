import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { Invitation, RevokeInvitationResult } from "./types";

// Marks a pending invitation as revoked. Once revoked, the token hash is
// no longer accepted by accept-flow validation (P2-3). Already-accepted
// or already-revoked invitations cannot be re-revoked — surface a clear
// error so admins know the action was a no-op.
//
// Caller (route handler) is responsible for permission checks via
// requireCanDoForApi(companyId, "manage_invitations"). The lib trusts
// that check has run; it does NOT re-validate role here.

export async function revokeInvitation(
  invitationId: string,
  revokedBy: string | null,
): Promise<RevokeInvitationResult> {
  const svc = getServiceRoleClient();

  const lookupResult = await svc
    .from("platform_invitations")
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .eq("id", invitationId)
    .maybeSingle();

  if (lookupResult.error) {
    logger.error("invitations.revoke.lookup_failed", {
      err: lookupResult.error.message,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Lookup failed: ${lookupResult.error.message}`,
      },
    };
  }

  if (!lookupResult.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "No invitation with that id.",
      },
    };
  }

  const existing = lookupResult.data as Invitation;

  if (existing.status === "accepted" || existing.accepted_at) {
    return {
      ok: false,
      error: {
        code: "ALREADY_ACCEPTED",
        message:
          "This invitation was already accepted; revoke the user via user management instead.",
      },
    };
  }

  if (existing.status === "revoked" || existing.revoked_at) {
    return {
      ok: false,
      error: {
        code: "ALREADY_REVOKED",
        message: "This invitation was already revoked.",
      },
    };
  }

  // `revokedBy` (parameter) is captured for future audit-log expansion;
  // the V1 platform_invitations schema records revocation via revoked_at
  // only. When platform_audit_log lands (post-V1), wire this in.
  void revokedBy;

  const updateResult = await svc
    .from("platform_invitations")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
    })
    .eq("id", invitationId)
    .select(
      "id, company_id, email, role, status, expires_at, invited_by, accepted_at, accepted_user_id, revoked_at, reminder_sent_at, expired_notified_at, created_at",
    )
    .single();

  if (updateResult.error) {
    logger.error("invitations.revoke.update_failed", {
      err: updateResult.error.message,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Update failed: ${updateResult.error.message}`,
      },
    };
  }

  return { ok: true, invitation: updateResult.data as Invitation };
}
