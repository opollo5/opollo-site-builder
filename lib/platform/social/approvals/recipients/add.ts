import "server-only";

import { randomUUID } from "node:crypto";

import { logger } from "@/lib/logger";
import { issue } from "@/lib/platform/magic-link";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { AddRecipientInput, AddRecipientResult } from "../types";

// ---------------------------------------------------------------------------
// S1-6 — add a recipient (reviewer) to an open approval_request.
//
// Token contract (B1 upgrade):
//   - Issue via magic-link service (purpose='approval').
//   - Dual write: magic_links.token_hash AND social_approval_recipients.token_hash
//     are kept in sync so the legacy /approve/[token] lookup still works
//     for tokens issued before the service migration.
//   - magic_link_id FK set on the recipient row for new-token lookups.
//   - Pre-generate recipient UUID so magic_links.subject_id is set at
//     issuance time (no second UPDATE round-trip).
//
// Caller is responsible for canDo("submit_for_approval", companyId).
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

  // 1. Verify the parent request belongs to companyId and is still open.
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
    return internal(
      `Failed to read approval request: ${reqLookup.error.message}`,
    );
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

  // 2. Resolve platform user id for audit attribution.
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

  // 3. Pre-generate recipient UUID so magic_links.subject_id can be set
  //    at issuance time without a second UPDATE.
  const recipientId = randomUUID();

  // 4. Issue via the magic-link service.
  let magicLinkIssue: Awaited<ReturnType<typeof issue>>;
  try {
    magicLinkIssue = await issue({
      purpose: "approval",
      subjectType: "approval_recipient",
      subjectId: recipientId,
      companyId: input.companyId,
      email,
    });
  } catch (err) {
    logger.error("social.approvals.recipients.add.magic_link_issue_failed", {
      err: String(err),
    });
    return internal("Failed to issue magic link for recipient.");
  }

  // 5. Insert recipient with dual-write token_hash + magic_link_id.
  const insertResult = await svc
    .from("social_approval_recipients")
    .insert({
      id: recipientId,
      approval_request_id: input.approvalRequestId,
      email,
      name: input.name?.trim() || null,
      platform_user_id: platformUserId,
      token_hash: magicLinkIssue.link.token_hash, // back-compat: legacy lookup still works
      magic_link_id: magicLinkIssue.link.id,       // new service FK
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
    return internal(
      `Failed to add recipient: ${insertResult.error.message}`,
    );
  }

  return {
    ok: true,
    data: {
      recipient: insertResult.data as AddRecipientResult["recipient"],
      rawToken: magicLinkIssue.rawToken,
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
  logger.error("social.approvals.recipients.add.internal_error", { message });
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
