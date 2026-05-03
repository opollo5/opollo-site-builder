import "server-only";

import { logger } from "@/lib/logger";
import { listVariants } from "@/lib/platform/social/variants";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-5 — submit-for-approval state transition.
//
// Calls the Postgres function submit_post_for_approval (migration 0071)
// which performs the state flip + approval_request snapshot insert in
// a single transaction. The function uses SECURITY DEFINER so the
// service-role client can call it.
//
// The snapshot is built application-side from the post + variant
// rows, then passed in. We could read inside the SQL function, but
// that adds branching in plpgsql and obscures the snapshot shape from
// the application contract. Building it here also lets the lib unit-
// test the snapshot shape independently.
//
// Caller is responsible for canDo("submit_for_approval", company_id).
// ---------------------------------------------------------------------------

const APPROVAL_TTL_DAYS = 14;

export type SubmitForApprovalResult = {
  approvalRequestId: string;
  // Echo the snapshot so the route can return it for client display
  // (or log it for audit).
  snapshot: ApprovalSnapshot;
};

export type ApprovalSnapshot = {
  // V1 schema. The approval-flow consumer (snapshot reader) reads
  // these keys directly; do NOT rename without coordinating.
  master_text: string | null;
  link_url: string | null;
  variants: ReadonlyArray<{
    platform: string;
    variant_text: string | null;
    is_custom: boolean;
  }>;
  // Captured at submit time so the reviewer sees what was asked of them.
  submitted_at: string;
};

export async function submitForApproval(args: {
  postId: string;
  companyId: string;
  // Caller-provided expiry override (test plumbing); production
  // defaults to +14 days.
  expiresAt?: string;
}): Promise<ApiResponse<SubmitForApprovalResult>> {
  if (!args.postId) return validation("Post id is required.");
  if (!args.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // Read the parent post + variants to build the snapshot. We do this
  // BEFORE the RPC so the snapshot we send is exactly what we're
  // committing. The atomic transition inside the function still
  // catches concurrent edits via the state='draft' predicate; if
  // someone else flips the state in the window between our read and
  // the RPC, the function returns INVALID_STATE.
  const post = await svc
    .from("social_post_master")
    .select("id, state, master_text, link_url")
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .maybeSingle();
  if (post.error) {
    logger.error("social.posts.submit.post_lookup_failed", {
      err: post.error.message,
      post_id: args.postId,
    });
    return internal(`Failed to read post: ${post.error.message}`);
  }
  if (!post.data) return notFound();

  if (post.data.state !== "draft") {
    return invalidState(
      `Post is in '${post.data.state}', not 'draft'.`,
    );
  }

  if (!post.data.master_text && !post.data.link_url) {
    return validation(
      "Cannot submit a post with neither master_text nor link_url.",
    );
  }

  const variants = await listVariants({
    postMasterId: args.postId,
    companyId: args.companyId,
  });
  if (!variants.ok) {
    // listVariants already returns the standard envelope shape; bubble
    // it up unchanged.
    return variants;
  }

  const snapshot: ApprovalSnapshot = {
    master_text: (post.data.master_text as string | null) ?? null,
    link_url: (post.data.link_url as string | null) ?? null,
    variants: variants.data.resolved.map((r) => ({
      platform: r.platform,
      variant_text: r.variant?.is_custom
        ? (r.variant.variant_text ?? null)
        : null,
      is_custom: r.variant?.is_custom === true,
    })),
    submitted_at: new Date().toISOString(),
  };

  const expiresAt =
    args.expiresAt ??
    new Date(
      Date.now() + APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

  const rpc = await svc.rpc("submit_post_for_approval", {
    p_post_id: args.postId,
    p_company_id: args.companyId,
    p_snapshot: snapshot,
    p_expires_at: expiresAt,
  });

  if (rpc.error) {
    // The function raises P0001 (INVALID_STATE) and P0002 (NOT_FOUND)
    // with the precise error in the message. PostgREST surfaces these
    // as { code: 'P0001' | 'P0002', message: 'INVALID_STATE: ...' }.
    if (rpc.error.code === "P0001") {
      return invalidState(stripPrefix(rpc.error.message, "INVALID_STATE: "));
    }
    if (rpc.error.code === "P0002") {
      return notFoundWith(stripPrefix(rpc.error.message, "NOT_FOUND: "));
    }
    logger.error("social.posts.submit.rpc_failed", {
      err: rpc.error.message,
      code: rpc.error.code,
      post_id: args.postId,
    });
    return internal(`Submit RPC failed: ${rpc.error.message}`);
  }

  // The function returns the new approval_request id as the scalar
  // result. supabase-js rpc() with a scalar function returns it on
  // `data` directly.
  const approvalRequestId = rpc.data as unknown as string;
  if (!approvalRequestId) {
    return internal("Submit RPC returned no approval_request id.");
  }

  return {
    ok: true,
    data: { approvalRequestId, snapshot },
    timestamp: new Date().toISOString(),
  };
}

function stripPrefix(message: string, prefix: string): string {
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function validation(
  message: string,
): ApiResponse<SubmitForApprovalResult> {
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

function invalidState(
  message: string,
): ApiResponse<SubmitForApprovalResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; another user may have already submitted or moved this post.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notFound(): ApiResponse<SubmitForApprovalResult> {
  return notFoundWith("No post with that id in this company.");
}

function notFoundWith(
  message: string,
): ApiResponse<SubmitForApprovalResult> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message,
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<SubmitForApprovalResult> {
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

// ---------------------------------------------------------------------------
// S1-9 — reopen a `changes_requested` post for editing.
//
// Flips state changes_requested → draft so the editor can revise and
// re-submit. The originating approval_request stays in its finalised
// state — its snapshot + events are preserved as the audit trail. The
// editor's next submitForApproval will mint a fresh approval_request.
//
// Atomic single-row UPDATE with predicate (`state = 'changes_requested'`)
// — concurrent reopens converge: one transitions, the others see 0
// rows updated and return INVALID_STATE.
//
// Caller is responsible for canDo("edit_post", company_id).
// ---------------------------------------------------------------------------

export type ReopenForEditingResult = {
  postId: string;
  postState: "draft";
};

export async function reopenForEditing(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<ReopenForEditingResult>> {
  if (!args.postId) {
    return reopenValidation("Post id is required.");
  }
  if (!args.companyId) {
    return reopenValidation("Company id is required.");
  }

  const svc = getServiceRoleClient();

  // Atomic predicate-guarded UPDATE. If the post moved out of
  // changes_requested between client-side click and our UPDATE, we
  // return 0 rows and surface INVALID_STATE rather than clobbering
  // the now-current state.
  const update = await svc
    .from("social_post_master")
    .update({ state: "draft" })
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "changes_requested")
    .select("id, state")
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.reopen.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: args.postId,
    });
    return reopenInternal(`Failed to reopen post: ${update.error.message}`);
  }

  if (!update.data) {
    // Either the post doesn't exist in this company OR it's not in
    // changes_requested. Disambiguate via a follow-up read so the
    // caller gets a useful envelope.
    const lookup = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", args.postId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    if (lookup.error) {
      return reopenInternal(`Lookup failed: ${lookup.error.message}`);
    }
    if (!lookup.data) {
      return reopenNotFound();
    }
    return reopenInvalidState(
      `Post is in '${lookup.data.state}', not 'changes_requested'. Only changes_requested posts can be reopened for editing.`,
    );
  }

  return {
    ok: true,
    data: {
      postId: update.data.id as string,
      postState: "draft",
    },
    timestamp: new Date().toISOString(),
  };
}

function reopenValidation(
  message: string,
): ApiResponse<ReopenForEditingResult> {
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

function reopenNotFound(): ApiResponse<ReopenForEditingResult> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No post with that id in this company.",
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function reopenInvalidState(
  message: string,
): ApiResponse<ReopenForEditingResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; another user may have already moved this post.",
    },
    timestamp: new Date().toISOString(),
  };
}

function reopenInternal(
  message: string,
): ApiResponse<ReopenForEditingResult> {
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

// ---------------------------------------------------------------------------
// S1-10 — admin cancel of a pending_client_approval request.
//
// Calls the migration-0073 cancel_post_approval Postgres function which
// atomically:
//   1. Flips post state pending_client_approval → draft
//   2. Revokes the open approval_request (revoked_at = now())
//   3. Inserts a 'revoked' social_approval_events row tied to the
//      acting platform user with the supplied reason
//
// Caller is responsible for canDo("edit_post", company_id) AND for
// passing the platform user's id as actorUserId (typically from
// requireCanDoForApi's gate.userId).
// ---------------------------------------------------------------------------

export type CancelApprovalResult = {
  postId: string;
  postState: "draft";
  // True when an open approval_request was revoked. False on the
  // defensive "no open request" path (post somehow in pending state
  // without one).
  revoked: boolean;
  // Audit event id from the FOR-UPDATE loop. null when no request was
  // revoked.
  eventId: string | null;
};

export async function cancelApprovalRequest(args: {
  postId: string;
  companyId: string;
  actorUserId: string;
  reason?: string | null;
}): Promise<ApiResponse<CancelApprovalResult>> {
  if (!args.postId) return cancelValidation("Post id is required.");
  if (!args.companyId) return cancelValidation("Company id is required.");
  if (!args.actorUserId) {
    return cancelValidation("Actor user id is required.");
  }

  const svc = getServiceRoleClient();

  const rpc = await svc.rpc("cancel_post_approval", {
    p_post_id: args.postId,
    p_company_id: args.companyId,
    p_actor_user_id: args.actorUserId,
    p_reason: args.reason ?? null,
  });

  if (rpc.error) {
    if (rpc.error.code === "P0001") {
      return cancelInvalidState(
        cancelStripPrefix(rpc.error.message, "INVALID_STATE: "),
      );
    }
    if (rpc.error.code === "P0002") {
      return cancelNotFound(
        cancelStripPrefix(rpc.error.message, "NOT_FOUND: "),
      );
    }
    logger.error("social.posts.cancel_approval.rpc_failed", {
      err: rpc.error.message,
      code: rpc.error.code,
      post_id: args.postId,
    });
    return cancelInternal(`Cancel RPC failed: ${rpc.error.message}`);
  }

  const payload = rpc.data as {
    post_id: string;
    post_state: string;
    revoked: boolean;
    event_id: string | null;
  };
  if (!payload?.post_id) {
    return cancelInternal("Cancel RPC returned an empty payload.");
  }

  return {
    ok: true,
    data: {
      postId: payload.post_id,
      postState: "draft",
      revoked: payload.revoked === true,
      eventId: payload.event_id ?? null,
    },
    timestamp: new Date().toISOString(),
  };
}

function cancelStripPrefix(message: string, prefix: string): string {
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function cancelValidation(
  message: string,
): ApiResponse<CancelApprovalResult> {
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

function cancelInvalidState(
  message: string,
): ApiResponse<CancelApprovalResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; another user may have already moved this post.",
    },
    timestamp: new Date().toISOString(),
  };
}

function cancelNotFound(
  message: string,
): ApiResponse<CancelApprovalResult> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message,
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function cancelInternal(
  message: string,
): ApiResponse<CancelApprovalResult> {
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

// ---------------------------------------------------------------------------
// S1-48 — Platform-user approver decisions: pending_client_approval → *
//
// Three transitions driven by internal platform users with the `approver`
// role (or Opollo staff bypass). These are simple predicate-guarded UPDATEs
// that bypass the `record_approval_decision` Postgres function which is
// designed for external recipient-token flows. The state_changed_at trigger
// (migration 0070) fires automatically on each UPDATE.
//
// Caller is responsible for canDo("approve_post" | "reject_post", company_id).
// ---------------------------------------------------------------------------

export type ApprovePostResult = {
  postId: string;
  postState: "approved";
};

export async function approvePost(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<ApprovePostResult>> {
  if (!args.postId) return approveValidation("Post id is required.");
  if (!args.companyId) return approveValidation("Company id is required.");

  const svc = getServiceRoleClient();

  const update = await svc
    .from("social_post_master")
    .update({ state: "approved" })
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "pending_client_approval")
    .select("id, state")
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.approve.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: args.postId,
    });
    return approveInternal(`Failed to approve post: ${update.error.message}`);
  }

  if (!update.data) {
    const lookup = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", args.postId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    if (lookup.error) return approveInternal(`Lookup failed: ${lookup.error.message}`);
    if (!lookup.data) return approveNotFound();
    return approveInvalidState(
      `Post is in '${lookup.data.state}', not 'pending_client_approval'.`,
    );
  }

  return {
    ok: true,
    data: { postId: update.data.id as string, postState: "approved" },
    timestamp: new Date().toISOString(),
  };
}

function approveValidation(message: string): ApiResponse<ApprovePostResult> {
  return { ok: false, error: { code: "VALIDATION_FAILED", message, retryable: false, suggested_action: "Fix the input and resubmit." }, timestamp: new Date().toISOString() };
}
function approveInvalidState(message: string): ApiResponse<ApprovePostResult> {
  return { ok: false, error: { code: "INVALID_STATE", message, retryable: false, suggested_action: "Reload the page; another user may have already moved this post." }, timestamp: new Date().toISOString() };
}
function approveNotFound(): ApiResponse<ApprovePostResult> {
  return { ok: false, error: { code: "NOT_FOUND", message: "No post with that id in this company.", retryable: false, suggested_action: "Check the post id." }, timestamp: new Date().toISOString() };
}
function approveInternal(message: string): ApiResponse<ApprovePostResult> {
  return { ok: false, error: { code: "INTERNAL_ERROR", message, retryable: false, suggested_action: "Retry. If the error persists, contact support." }, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------

export type RejectPostResult = {
  postId: string;
  postState: "rejected";
};

export async function rejectPost(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<RejectPostResult>> {
  if (!args.postId) return rejectValidation("Post id is required.");
  if (!args.companyId) return rejectValidation("Company id is required.");

  const svc = getServiceRoleClient();

  const update = await svc
    .from("social_post_master")
    .update({ state: "rejected" })
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "pending_client_approval")
    .select("id, state")
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.reject.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: args.postId,
    });
    return rejectInternal(`Failed to reject post: ${update.error.message}`);
  }

  if (!update.data) {
    const lookup = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", args.postId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    if (lookup.error) return rejectInternal(`Lookup failed: ${lookup.error.message}`);
    if (!lookup.data) return rejectNotFound();
    return rejectInvalidState(
      `Post is in '${lookup.data.state}', not 'pending_client_approval'.`,
    );
  }

  return {
    ok: true,
    data: { postId: update.data.id as string, postState: "rejected" },
    timestamp: new Date().toISOString(),
  };
}

function rejectValidation(message: string): ApiResponse<RejectPostResult> {
  return { ok: false, error: { code: "VALIDATION_FAILED", message, retryable: false, suggested_action: "Fix the input and resubmit." }, timestamp: new Date().toISOString() };
}
function rejectInvalidState(message: string): ApiResponse<RejectPostResult> {
  return { ok: false, error: { code: "INVALID_STATE", message, retryable: false, suggested_action: "Reload the page; another user may have already moved this post." }, timestamp: new Date().toISOString() };
}
function rejectNotFound(): ApiResponse<RejectPostResult> {
  return { ok: false, error: { code: "NOT_FOUND", message: "No post with that id in this company.", retryable: false, suggested_action: "Check the post id." }, timestamp: new Date().toISOString() };
}
function rejectInternal(message: string): ApiResponse<RejectPostResult> {
  return { ok: false, error: { code: "INTERNAL_ERROR", message, retryable: false, suggested_action: "Retry. If the error persists, contact support." }, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------

export type RequestChangesResult = {
  postId: string;
  postState: "changes_requested";
};

export async function requestChanges(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<RequestChangesResult>> {
  if (!args.postId) return requestChangesValidation("Post id is required.");
  if (!args.companyId) return requestChangesValidation("Company id is required.");

  const svc = getServiceRoleClient();

  const update = await svc
    .from("social_post_master")
    .update({ state: "changes_requested" })
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "pending_client_approval")
    .select("id, state")
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.request_changes.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: args.postId,
    });
    return requestChangesInternal(`Failed to request changes: ${update.error.message}`);
  }

  if (!update.data) {
    const lookup = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", args.postId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    if (lookup.error) return requestChangesInternal(`Lookup failed: ${lookup.error.message}`);
    if (!lookup.data) return requestChangesNotFound();
    return requestChangesInvalidState(
      `Post is in '${lookup.data.state}', not 'pending_client_approval'.`,
    );
  }

  return {
    ok: true,
    data: { postId: update.data.id as string, postState: "changes_requested" },
    timestamp: new Date().toISOString(),
  };
}

function requestChangesValidation(message: string): ApiResponse<RequestChangesResult> {
  return { ok: false, error: { code: "VALIDATION_FAILED", message, retryable: false, suggested_action: "Fix the input and resubmit." }, timestamp: new Date().toISOString() };
}
function requestChangesInvalidState(message: string): ApiResponse<RequestChangesResult> {
  return { ok: false, error: { code: "INVALID_STATE", message, retryable: false, suggested_action: "Reload the page; another user may have already moved this post." }, timestamp: new Date().toISOString() };
}
function requestChangesNotFound(): ApiResponse<RequestChangesResult> {
  return { ok: false, error: { code: "NOT_FOUND", message: "No post with that id in this company.", retryable: false, suggested_action: "Check the post id." }, timestamp: new Date().toISOString() };
}
function requestChangesInternal(message: string): ApiResponse<RequestChangesResult> {
  return { ok: false, error: { code: "INTERNAL_ERROR", message, retryable: false, suggested_action: "Retry. If the error persists, contact support." }, timestamp: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// S1-44 — MSP release: pending_msp_release → approved.
//
// Opollo staff (or a company admin) marks a post as approved after their
// internal review. No SQL function needed — a single predicate-guarded
// UPDATE is atomic and correct.
//
// Caller is responsible for canDo("release_post", company_id).
// ---------------------------------------------------------------------------

export type ReleasePostResult = {
  postId: string;
  postState: "approved";
};

export async function releasePost(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<ReleasePostResult>> {
  if (!args.postId) return releaseValidation("Post id is required.");
  if (!args.companyId) return releaseValidation("Company id is required.");

  const svc = getServiceRoleClient();

  const update = await svc
    .from("social_post_master")
    .update({ state: "approved" })
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "pending_msp_release")
    .select("id, state")
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.release.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: args.postId,
    });
    return releaseInternal(`Failed to release post: ${update.error.message}`);
  }

  if (!update.data) {
    const lookup = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", args.postId)
      .eq("company_id", args.companyId)
      .maybeSingle();
    if (lookup.error) {
      return releaseInternal(`Lookup failed: ${lookup.error.message}`);
    }
    if (!lookup.data) return releaseNotFound();
    return releaseInvalidState(
      `Post is in '${lookup.data.state}', not 'pending_msp_release'.`,
    );
  }

  return {
    ok: true,
    data: { postId: update.data.id as string, postState: "approved" },
    timestamp: new Date().toISOString(),
  };
}

function releaseValidation(message: string): ApiResponse<ReleasePostResult> {
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

function releaseInvalidState(message: string): ApiResponse<ReleasePostResult> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; another user may have already moved this post.",
    },
    timestamp: new Date().toISOString(),
  };
}

function releaseNotFound(): ApiResponse<ReleasePostResult> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No post with that id in this company.",
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function releaseInternal(message: string): ApiResponse<ReleasePostResult> {
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
