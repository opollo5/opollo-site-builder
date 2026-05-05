import "server-only";

import { logger } from "@/lib/logger";
import { generateRawToken, hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { AddRecipientInput, AddRecipientResult } from "../types";

// ---------------------------------------------------------------------------
// S1-6 — add a recipient (reviewer) to an open approval_request.
//
// The caller passes an approval_request_id; we verify the parent
// request belongs to companyId and is still open (not revoked + not
// already finalised) before inserting the recipient row.
//
// Token contract:
//   - Generate a 64-char hex random token.
//   - Store SHA-256 hex hash in social_approval_recipients.token_hash.
//   - Return the raw token ONCE to the caller for the email body.
//   - Caller must build the magic-link URL and send the email; the
//     lib does not know the deployment origin and stays decoupled
//     from SendGrid for testability (mirror of sendInvitation in
//     lib/platform/invitations).
//
// Caller is responsible for canDo("submit_for_approval", companyId).
// Approval recipients can be added by anyone who could submit the
// post — typically the editor who drafted it.
// ---------------------------------------------------------------------------

export async function addRecipient(
  input: AddRecipientInput,
): Promise<ApiResponse<AddRecipientResult>> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return validation("A valid email is required.");
  }
  if (!input.approvalRequestId) {
    return validation("Approval request id is required.");
  }
  if (!input.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();

  // 1. Look up the parent request, scope by company_id, verify it's
  // still open. Open = !revoked_at AND no final_*_at timestamps.
  // Scoping at the lib (in addition to RLS) so a service-role caller
  // can't add recipients to another company's request via stale id.
  const reqLookup = await svc
    .from("social_approval_requests")
    .select(
      "id, company_id, revoked_at, final_approved_at, final_rejected_at, expires_at",
    )
    .eq("id", input.approvalRequestId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (reqLookup.error) {
    logger.error("social.approvals.recipients.add.req_lookup_failed", {
      err: reqLookup.error.message,
      approval_request_id: input.approvalRequestId,
    });
    return internal(`Failed to read approval request: ${reqLookup.error.message}`);
  }
  if (!reqLookup.data) {
    return notFound("No approval request with that id in this company.");
  }
  if (reqLookup.data.revoked_at) {
    return invalidState("Approval request was revoked.");
  }
  if (reqLookup.data.final_approved_at || reqLookup.data.final_rejected_at) {
    return invalidState("Approval request is already finalised.");
  }
  // expires_at is informational here — the recipient list works
  // until revoke/finalise; the magic-link viewer slice will reject
  // expired tokens server-side at click time.

  // 2. Look up whether this email already corresponds to a platform
  // user, to denormalise the link in social_approval_recipients
  // (audit makes "approved by" attribution easier downstream).
  const userLookup = await svc
    .from("platform_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (userLookup.error) {
    logger.error("social.approvals.recipients.add.user_lookup_failed", {
      err: userLookup.error.message,
    });
    return internal(`Failed to read user: ${userLookup.error.message}`);
  }
  const platformUserId = userLookup.data?.id ?? null;

  // 3. Generate the token.
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  // 4. Insert. The schema has no UNIQUE on (approval_request_id, email)
  // — operators can deliberately add the same email twice (e.g. send
  // two reminder rounds with different tokens). That matches the spec:
  // each recipient row is one magic link.
  const insertResult = await svc
    .from("social_approval_recipients")
    .insert({
      approval_request_id: input.approvalRequestId,
      email,
      name: input.name?.trim() || null,
      platform_user_id: platformUserId,
      token_hash: tokenHash,
      requires_otp: input.requiresOtp === true,
    })
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .single();

  if (insertResult.error) {
    logger.error("social.approvals.recipients.add.insert_failed", {
      err: insertResult.error.message,
      code: insertResult.error.code,
      approval_request_id: input.approvalRequestId,
    });
    return internal(`Failed to add recipient: ${insertResult.error.message}`);
  }

  return {
    ok: true,
    data: {
      recipient: insertResult.data as AddRecipientResult["recipient"],
      rawToken,
    },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<AddRecipientResult> {
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

function notFound(message: string): ApiResponse<AddRecipientResult> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message,
      retryable: false,
      suggested_action: "Check the approval request id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function invalidState(message: string): ApiResponse<AddRecipientResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "The approval request is no longer accepting new recipients.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<AddRecipientResult> {
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
