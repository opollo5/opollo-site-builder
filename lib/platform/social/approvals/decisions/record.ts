import "server-only";

import { logger } from "@/lib/logger";
import { hashToken } from "@/lib/platform/invitations";
import { consume, validate } from "@/lib/platform/magic-link";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ApprovalRecipient } from "../types";

// ---------------------------------------------------------------------------
// S1-7 — record an approval decision via magic-link.
//
// Two phases:
//   A. Token resolution (this lib) — two lookup paths:
//        • New tokens (magic_links row exists): validate via service.
//          If a magic_links row exists, its verdict is FINAL — the legacy
//          token_hash fallback MUST NOT be used even if the row is invalid.
//        • Legacy tokens (no magic_links row): hash → direct lookup on
//          social_approval_recipients.token_hash.
//   B. RPC call to record_approval_decision (migration 0072).
//
// resolveRecipientByToken additionally calls consume() (session open)
// for new tokens on every page-load; recordApprovalDecision calls
// validate() (read-only) to confirm the session is still active.
// ---------------------------------------------------------------------------

export type Decision = "approved" | "rejected" | "changes_requested";

export type RecordDecisionInput = {
  rawToken: string;
  decision: Decision;
  comment?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RecordDecisionResult = {
  requestId: string;
  postId: string | null;      // null for content_proof (no V1 post)
  postState: string | null;   // null for content_proof
  finalised: boolean;
  eventId: string;
};

// Resolve the recipient + parent context from a raw magic-link token.
// Calls consume() for new tokens — establishes the session on first page-load.
// Returns NOT_FOUND when the token doesn't match anything; SESSION_EXPIRED
// when the reviewer needs a fresh link; never throws.
export async function resolveRecipientByToken(
  rawToken: string,
): Promise<
  ApiResponse<{
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
    postState: string | null;
  }>
> {
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return tokenNotFound();
  }

  const tokenHash = hashToken(rawToken);
  const svc = getServiceRoleClient();

  // -------------------------------------------------------------------------
  // Step 1: check for a magic_links row.
  // HARD RULE: if a row exists, honour its verdict exclusively.
  // Fall back to legacy lookup only when NO magic_links row exists.
  // -------------------------------------------------------------------------
  const mlLookup = await svc
    .from("magic_links")
    .select("id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  let recipientRow: { id: string } | null = null;

  if (mlLookup.error) {
    logger.error("social.approvals.decisions.ml_lookup_failed", {
      err: mlLookup.error.message,
    });
    return internal("Token lookup failed.");
  }

  if (mlLookup.data) {
    // New token — consume (establishes session on first access; idempotent thereafter)
    const consumeResult = await consume(rawToken);
    if (!consumeResult.valid) {
      if (consumeResult.reason === "session_expired") {
        return sessionExpired();
      }
      return tokenNotFound();
    }
    // Resolve recipient via magic_link_id FK
    const rl = await svc
      .from("social_approval_recipients")
      .select("id")
      .eq("magic_link_id", mlLookup.data.id)
      .maybeSingle();
    if (rl.error || !rl.data) return tokenNotFound();
    recipientRow = rl.data as { id: string };
  } else {
    // Legacy token — direct hash lookup (back-compat)
    const rl = await svc
      .from("social_approval_recipients")
      .select("id")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (rl.error || !rl.data) return tokenNotFound();
    recipientRow = rl.data as { id: string };
  }

  // -------------------------------------------------------------------------
  // Step 2: hydrate the full recipient + request + company + post state.
  // -------------------------------------------------------------------------
  const recipient = await svc
    .from("social_approval_recipients")
    .select(
      "id, approval_request_id, email, name, platform_user_id, requires_otp, otp_expires_at, revoked_at, created_at",
    )
    .eq("id", recipientRow.id)
    .maybeSingle();
  if (recipient.error || !recipient.data) {
    return internal("Approval recipient missing.");
  }

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

  // V2 content_proof subject_type: post_master_id is null — skip V1 post lookup.
  // postState is returned as null; the approve page treats null as non-finalised
  // (the finalisation check uses final_approved_at / final_rejected_at instead).
  let postState: string | null = null;
  if (request.data.post_master_id) {
    const post = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", request.data.post_master_id as string)
      .maybeSingle();
    if (post.error || !post.data) {
      return internal("Post missing for this approval request.");
    }
    postState = post.data.state as string;
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
      postState,
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

  // -------------------------------------------------------------------------
  // Token resolution (same dual-path as resolveRecipientByToken).
  // HARD RULE: magic_links row present → honour its verdict; no fallthrough.
  // -------------------------------------------------------------------------
  const mlLookup = await svc
    .from("magic_links")
    .select("id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (mlLookup.error) {
    logger.error("social.approvals.decisions.token_lookup_failed", {
      err: mlLookup.error.message,
    });
    return internal(`Token lookup failed: ${mlLookup.error.message}`);
  }

  let recipientId: string;

  if (mlLookup.data) {
    // New token — validate session is still active (read-only, no re-consume)
    const vr = await validate(input.rawToken);
    if (!vr.valid) {
      if (vr.reason === "session_expired") {
        return sessionExpired();
      }
      return tokenNotFound();
    }
    const rl = await svc
      .from("social_approval_recipients")
      .select("id")
      .eq("magic_link_id", mlLookup.data.id)
      .maybeSingle();
    if (rl.error || !rl.data) return tokenNotFound();
    recipientId = (rl.data as { id: string }).id;
  } else {
    // Legacy token — direct hash lookup
    const rl = await svc
      .from("social_approval_recipients")
      .select("id")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (rl.error) {
      logger.error("social.approvals.decisions.legacy_token_lookup_failed", {
        err: rl.error.message,
      });
      return internal(`Token lookup failed: ${rl.error.message}`);
    }
    if (!rl.data) return tokenNotFound();
    recipientId = (rl.data as { id: string }).id;
  }

  const rpc = await svc.rpc("record_approval_decision", {
    p_recipient_id: recipientId,
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

function sessionExpired<T>(): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "SESSION_EXPIRED",
      message: "Your review session has expired.",
      retryable: false,
      suggested_action:
        "Request a fresh link by entering your email on the re-request page.",
    },
    timestamp: new Date().toISOString(),
  };
}

function tokenNotFound<T>(): ApiResponse<T> {
  return notFound<T>("This approval link is invalid or has been revoked.");
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
  logger.error("social.approvals.decisions.record.internal_error", { message });
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
