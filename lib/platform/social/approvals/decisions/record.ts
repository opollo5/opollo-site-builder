import "server-only";

import { logger } from "@/lib/logger";
import { hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ApprovalRecipient } from "../types";

// ---------------------------------------------------------------------------
// S1-7 — record an approval decision via magic-link.
//
// Two phases:
//   A. Token verification (this lib): hash the raw token, look up
//      the recipient row, return NOT_FOUND on no match. We deliberately
//      do NOT pre-check revoked_at / parent state here — we let the
//      atomic SQL function handle that so the decision recording and
//      the state checks happen in one transaction.
//   B. RPC call to record_approval_decision (migration 0072) which:
//      - re-checks recipient + parent request state
//      - inserts the event row
//      - finalises the request + flips the post state per approval_rule
//      - all atomic
//
// Token-as-auth: the route layer trusts the SHA-256 hash match; there
// is no canDo gate. A leaked token grants exactly one decision on
// exactly one approval request and can be revoked by an admin.
// ---------------------------------------------------------------------------

export type Decision = "approved" | "rejected" | "changes_requested";

export type RecordDecisionInput = {
  rawToken: string;
  decision: Decision;
  comment?: string | null;
  // For audit columns. Caller passes from the request headers.
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RecordDecisionResult = {
  requestId: string;
  postId: string;
  postState: string;
  // True when this decision finalised the request. False for the
  // intermediate decisions in all_must mode.
  finalised: boolean;
  eventId: string;
};

// Resolve the recipient + parent context from a raw magic-link token.
// Returns NOT_FOUND when the token doesn't match anything; never
// throws. Useful for the viewer page (which renders state before
// asking the user to decide).
export async function resolveRecipientByToken(
  rawToken: string,
): Promise<ApiResponse<{
  recipient: ApprovalRecipient;
  request: {
    id: string;
    post_master_id: string;
    company_id: string;
    approval_rule: "any_one" | "all_must";
    expires_at: string;
    revoked_at: string | null;
    final_approved_at: string | null;
    final_rejected_at: string | null;
    snapshot_payload: unknown;
  };
  company: { id: string; name: string };
  postState: string;
}>> {
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return tokenNotFound();
  }

  const tokenHash = hashToken(rawToken);
  const svc = getServiceRoleClient();

  const recipient = await svc
    .from("social_approval_recipients")
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (recipient.error) {
    logger.error("social.approvals.decisions.token_lookup_failed", {
      err: recipient.error.message,
    });
    return internal(`Failed to read recipient: ${recipient.error.message}`);
  }
  if (!recipient.data) return tokenNotFound();

  const request = await svc
    .from("social_approval_requests")
    .select(
      "id, post_master_id, company_id, approval_rule, expires_at, revoked_at, final_approved_at, final_rejected_at, snapshot_payload",
    )
    .eq("id", recipient.data.approval_request_id as string)
    .maybeSingle();
  if (request.error || !request.data) {
    return internal("Approval request missing for this token.");
  }

  const company = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("id", request.data.company_id as string)
    .maybeSingle();
  if (company.error || !company.data) {
    return internal("Company missing for this approval request.");
  }

  const post = await svc
    .from("social_post_master")
    .select("state")
    .eq("id", request.data.post_master_id as string)
    .maybeSingle();
  if (post.error || !post.data) {
    return internal("Post missing for this approval request.");
  }

  return {
    ok: true,
    data: {
      recipient: recipient.data as ApprovalRecipient,
      request: request.data as {
        id: string;
        post_master_id: string;
        company_id: string;
        approval_rule: "any_one" | "all_must";
        expires_at: string;
        revoked_at: string | null;
        final_approved_at: string | null;
        final_rejected_at: string | null;
        snapshot_payload: unknown;
      },
      company: company.data as { id: string; name: string },
      postState: post.data.state as string,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function recordApprovalDecision(
  input: RecordDecisionInput,
): Promise<ApiResponse<RecordDecisionResult>> {
  if (!input.decision) return validation("decision is required.");
  if (
    input.decision !== "approved" &&
    input.decision !== "rejected" &&
    input.decision !== "changes_requested"
  ) {
    return validation(
      "decision must be one of: approved, rejected, changes_requested.",
    );
  }
  if (!input.rawToken || !/^[0-9a-f]{64}$/i.test(input.rawToken)) {
    return tokenNotFound();
  }

  const tokenHash = hashToken(input.rawToken);
  const svc = getServiceRoleClient();

  // Resolve recipient_id from token. Refresh-safe: a revoked or
  // expired recipient still resolves to its row here; the SQL
  // function will reject the decision atomically.
  const recipientRow = await svc
    .from("social_approval_recipients")
    .select("id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (recipientRow.error) {
    logger.error("social.approvals.decisions.token_lookup_failed", {
      err: recipientRow.error.message,
    });
    return internal(`Failed to read recipient: ${recipientRow.error.message}`);
  }
  if (!recipientRow.data) return tokenNotFound();

  const rpc = await svc.rpc("record_approval_decision", {
    p_recipient_id: recipientRow.data.id as string,
    p_decision: input.decision,
    p_comment: input.comment ?? null,
    p_ip: input.ipAddress ?? null,
    p_user_agent: input.userAgent ?? null,
  });

  if (rpc.error) {
    if (rpc.error.code === "P0001") {
      return invalidState(stripPrefix(rpc.error.message, "INVALID_STATE: "));
    }
    if (rpc.error.code === "P0002") {
      return notFound(stripPrefix(rpc.error.message, "NOT_FOUND: "));
    }
    logger.error("social.approvals.decisions.rpc_failed", {
      err: rpc.error.message,
      code: rpc.error.code,
    });
    return internal(`Decision RPC failed: ${rpc.error.message}`);
  }

  const payload = rpc.data as {
    request_id: string;
    post_id: string;
    post_state: string;
    finalised: boolean;
    event_id: string;
  };
  if (!payload?.request_id) {
    return internal("Decision RPC returned an empty payload.");
  }

  return {
    ok: true,
    data: {
      requestId: payload.request_id,
      postId: payload.post_id,
      postState: payload.post_state,
      finalised: payload.finalised === true,
      eventId: payload.event_id,
    },
    timestamp: new Date().toISOString(),
  };
}

function stripPrefix(message: string, prefix: string): string {
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function validation<T>(message: string): ApiResponse<T> {
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

function invalidState<T>(message: string): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; this approval may have already been finalised.",
    },
    timestamp: new Date().toISOString(),
  };
}

function tokenNotFound<T>(): ApiResponse<T> {
  return notFound<T>(
    "This approval link is invalid or has been revoked.",
  );
}

function notFound<T>(message: string): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message,
      retryable: false,
      suggested_action:
        "Ask the team that sent the link for a fresh invitation.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal<T>(message: string): ApiResponse<T> {
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
