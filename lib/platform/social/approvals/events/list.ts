import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ApprovalEventType } from "../types";

// ---------------------------------------------------------------------------
// S1-8 — list events for an approval_request.
//
// Returns the full audit log: every viewed / decision / state-change
// event the request has accumulated. Caller is responsible for the
// view_calendar canDo gate; the lib only enforces company scoping
// via the parent request.
// ---------------------------------------------------------------------------

export type ApprovalEvent = {
  id: string;
  approval_request_id: string;
  recipient_id: string | null;
  event_type: ApprovalEventType;
  comment_text: string | null;
  bound_identity_email: string | null;
  bound_identity_name: string | null;
  occurred_at: string;
};

export async function listApprovalEvents(args: {
  approvalRequestId: string;
  companyId: string;
}): Promise<ApiResponse<{ events: ApprovalEvent[] }>> {
  if (!args.approvalRequestId) {
    return validation("Approval request id is required.");
  }
  if (!args.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();

  const reqLookup = await svc
    .from("social_approval_requests")
    .select("id")
    .eq("id", args.approvalRequestId)
    .eq("company_id", args.companyId)
    .maybeSingle();
  if (reqLookup.error) {
    logger.error("social.approvals.events.list.req_lookup_failed", {
      err: reqLookup.error.message,
    });
    return internal(
      `Failed to read approval request: ${reqLookup.error.message}`,
    );
  }
  if (!reqLookup.data) return notFound();

  const rows = await svc
    .from("social_approval_events")
    .select(
      "id, approval_request_id, recipient_id, event_type, comment_text, bound_identity_email, bound_identity_name, occurred_at",
    )
    .eq("approval_request_id", args.approvalRequestId)
    .order("occurred_at", { ascending: true });

  if (rows.error) {
    logger.error("social.approvals.events.list.failed", {
      err: rows.error.message,
    });
    return internal(`Failed to list events: ${rows.error.message}`);
  }

  return {
    ok: true,
    data: { events: (rows.data ?? []) as ApprovalEvent[] },
    timestamp: new Date().toISOString(),
  };
}

function validation(
  message: string,
): ApiResponse<{ events: ApprovalEvent[] }> {
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

function notFound(): ApiResponse<{ events: ApprovalEvent[] }> {
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

function internal(message: string): ApiResponse<{ events: ApprovalEvent[] }> {
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
