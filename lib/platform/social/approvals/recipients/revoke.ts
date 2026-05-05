import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ApprovalRecipient } from "../types";

// ---------------------------------------------------------------------------
// S1-6 — revoke a recipient. Idempotent on revoked_at: re-revoking
// returns ALREADY_REVOKED rather than re-stamping. Once revoked, the
// magic-link viewer rejects the token even though token_hash is
// still on disk (the lookup will see revoked_at != null).
// ---------------------------------------------------------------------------

export async function revokeRecipient(args: {
  recipientId: string;
  // Same scoping discipline as add/list: the parent approval_request
  // must belong to this company.
  companyId: string;
}): Promise<ApiResponse<ApprovalRecipient>> {
  if (!args.recipientId) return validation("Recipient id is required.");
  if (!args.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // Two-FK lookup avoided: we read the recipient first, then the
  // parent request scoped by company, mirroring the
  // platform_company_users embed-failure pattern documented in
  // memory/feedback_postgrest_embed_ambiguous_fk.md.
  const recipientLookup = await svc
    .from("social_approval_recipients")
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .eq("id", args.recipientId)
    .maybeSingle();
  if (recipientLookup.error) {
    logger.error("social.approvals.recipients.revoke.lookup_failed", {
      err: recipientLookup.error.message,
    });
    return internal(`Failed to read recipient: ${recipientLookup.error.message}`);
  }
  if (!recipientLookup.data) return notFound();

  const recipient = recipientLookup.data as ApprovalRecipient;

  if (recipient.revoked_at) {
    return alreadyRevoked();
  }

  const reqLookup = await svc
    .from("social_approval_requests")
    .select("id")
    .eq("id", recipient.approval_request_id)
    .eq("company_id", args.companyId)
    .maybeSingle();
  if (reqLookup.error) {
    logger.error("social.approvals.recipients.revoke.req_lookup_failed", {
      err: reqLookup.error.message,
    });
    return internal(`Failed to scope check: ${reqLookup.error.message}`);
  }
  if (!reqLookup.data) {
    // Recipient exists but in another company. Keep the leak surface
    // narrow — return NOT_FOUND, not FORBIDDEN.
    return notFound();
  }

  // Atomic flip; concurrent revokes converge.
  const update = await svc
    .from("social_approval_recipients")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", args.recipientId)
    .is("revoked_at", null)
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .maybeSingle();

  if (update.error) {
    logger.error("social.approvals.recipients.revoke.update_failed", {
      err: update.error.message,
    });
    return internal(`Failed to revoke: ${update.error.message}`);
  }
  if (!update.data) {
    // Race: another request revoked it between our lookup and update.
    return alreadyRevoked();
  }

  return {
    ok: true,
    data: update.data as ApprovalRecipient,
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<ApprovalRecipient> {
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

function notFound(): ApiResponse<ApprovalRecipient> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No recipient with that id in this company.",
      retryable: false,
      suggested_action: "Check the recipient id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function alreadyRevoked(): ApiResponse<ApprovalRecipient> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message: "Recipient is already revoked.",
      retryable: false,
      suggested_action:
        "Add a new recipient if you need a fresh magic link.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<ApprovalRecipient> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
