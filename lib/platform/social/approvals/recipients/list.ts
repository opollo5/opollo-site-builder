import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ApprovalRecipient, ListRecipientsInput } from "../types";

// ---------------------------------------------------------------------------
// S1-6 — list recipients of an approval_request.
//
// Returns every recipient (including revoked) so the operator UI can
// render the full audit trail. The route layer's view_calendar gate
// is enough — every member of the company can see who was asked.
// ---------------------------------------------------------------------------

export async function listRecipients(
  input: ListRecipientsInput,
): Promise<ApiResponse<{ recipients: ApprovalRecipient[] }>> {
  if (!input.approvalRequestId) {
    return validation("Approval request id is required.");
  }
  if (!input.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();

  // Verify the parent request belongs to this company before listing.
  // Saves the caller from a "this request doesn't exist" 404 leaking
  // cross-company existence.
  const reqLookup = await svc
    .from("social_approval_requests")
    .select("id")
    .eq("id", input.approvalRequestId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (reqLookup.error) {
    logger.error("social.approvals.recipients.list.req_lookup_failed", {
      err: reqLookup.error.message,
    });
    return internal(`Failed to read approval request: ${reqLookup.error.message}`);
  }
  if (!reqLookup.data) {
    return notFound();
  }

  const rows = await svc
    .from("social_approval_recipients")
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .eq("approval_request_id", input.approvalRequestId)
    .order("created_at", { ascending: true });

  if (rows.error) {
    logger.error("social.approvals.recipients.list.failed", {
      err: rows.error.message,
    });
    return internal(`Failed to list recipients: ${rows.error.message}`);
  }

  return {
    ok: true,
    data: { recipients: (rows.data ?? []) as ApprovalRecipient[] },
    timestamp: new Date().toISOString(),
  };
}

function validation(
  message: string,
): ApiResponse<{ recipients: ApprovalRecipient[] }> {
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

function notFound(): ApiResponse<{ recipients: ApprovalRecipient[] }> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No approval request with that id in this company.",
      retryable: false,
      suggested_action: "Check the approval request id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(
  message: string,
): ApiResponse<{ recipients: ApprovalRecipient[] }> {
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
