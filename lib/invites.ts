import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P3.2 — Invite lifecycle helpers.
//
// Three operations:
//   - createInvite()  — generates a 32-byte raw token, hashes it for
//                       storage (sha256), inserts the invites row +
//                       user_audit_log row in a single transaction
//                       via the create_invite Postgres function. The
//                       raw token is RETURNED to the caller (for the
//                       email body) and never stored anywhere.
//   - revokeInvite()  — flips status to 'revoked' + writes audit row
//                       atomically via revoke_invite RPC.
//   - acceptInvite()  — validates the token, creates auth.users via
//                       Supabase admin API, then accepts the invite +
//                       writes audit row + promotes role via the
//                       accept_invite RPC. The Supabase admin API
//                       call is unavoidably outside the Postgres
//                       transaction; on partial failure (auth.users
//                       created, accept_invite failed), the orphaned
//                       auth.users row can complete signup via password
//                       reset.
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type InviteRole = "admin" | "user";

export interface CreateInviteInput {
  email: string;
  role: InviteRole;
  invitedBy: string | null;
}

export type CreateInviteResult =
  | {
      ok: true;
      invite_id: string;
      raw_token: string;
      expires_at: string;
    }
  | {
      ok: false;
      error: {
        code:
          | "PENDING_EXISTS"
          | "ACTIVE_USER_EXISTS"
          | "INVALID_ROLE"
          | "INTERNAL_ERROR";
        message: string;
      };
    };

export async function createInvite(
  input: CreateInviteInput,
): Promise<CreateInviteResult> {
  if (input.role !== "admin" && input.role !== "user") {
    return {
      ok: false,
      error: { code: "INVALID_ROLE", message: "Role must be 'admin' or 'user'." },
    };
  }

  const email = input.email.trim().toLowerCase();
  const supabase = getServiceRoleClient();

  // Pre-check: does an active (non-revoked) opollo_users row already
  // exist for this email? The brief: "Inviting an email that already
  // has an active user: API returns 409 ALREADY_ACTIVE."
  const userCheck = await supabase
    .from("opollo_users")
    .select("id, revoked_at")
    .eq("email", email)
    .maybeSingle();
  if (userCheck.error) {
    logger.error("invites.createInvite.user_lookup_failed", {
      err: userCheck.error.message,
    });
    return internalError(`User lookup failed: ${userCheck.error.message}`);
  }
  if (userCheck.data && userCheck.data.revoked_at === null) {
    return {
      ok: false,
      error: {
        code: "ACTIVE_USER_EXISTS",
        message:
          "This user is already active. To change their role, use the row action in /admin/users.",
      },
    };
  }

  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { data, error } = await supabase.rpc("create_invite", {
    p_email: email,
    p_role: input.role,
    p_invited_by: input.invitedBy,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error) {
    if (/INVITE_PENDING_EXISTS/.test(error.message)) {
      return {
        ok: false,
        error: {
          code: "PENDING_EXISTS",
          message:
            "An invite is already pending for this email. Revoke it first or wait for it to expire.",
        },
      };
    }
    logger.error("invites.createInvite.rpc_failed", { err: error.message });
    return internalError(error.message);
  }

  return {
    ok: true,
    invite_id: data as string,
    raw_token: rawToken,
    expires_at: expiresAt,
  };
}

export interface RevokeInviteInput {
  inviteId: string;
  actorId: string | null;
}

export type RevokeInviteResult =
  | { ok: true; revoked: boolean }
  | { ok: false; error: { code: string; message: string } };

export async function revokeInvite(
  input: RevokeInviteInput,
): Promise<RevokeInviteResult> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("revoke_invite", {
    p_invite_id: input.inviteId,
    p_actor_id: input.actorId,
  });
  if (error) {
    logger.error("invites.revokeInvite.rpc_failed", { err: error.message });
    return internalError(error.message);
  }
  return { ok: true, revoked: data === true };
}

export interface AcceptInviteInput {
  rawToken: string;
  password: string;
}

export type AcceptInviteResult =
  | {
      ok: true;
      user_id: string;
      email: string;
      role: InviteRole;
    }
  | {
      ok: false;
      error: {
        code:
          | "INVALID_TOKEN"
          | "EXPIRED"
          | "ALREADY_ACCEPTED"
          | "PASSWORD_TOO_SHORT"
          | "AUTH_CREATE_FAILED"
          | "INTERNAL_ERROR";
        message: string;
      };
    };

export async function acceptInvite(
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  if (input.password.length < 12) {
    return {
      ok: false,
      error: {
        code: "PASSWORD_TOO_SHORT",
        message: "Password must be at least 12 characters.",
      },
    };
  }
  const tokenHash = createHash("sha256").update(input.rawToken).digest("hex");
  const supabase = getServiceRoleClient();

  // 1. Look up the invite by token_hash. We accept any status here so
  //    the failure messages are precise (expired vs already accepted vs
  //    bad token); the accept_invite RPC re-validates atomically.
  const inviteRes = await supabase
    .from("invites")
    .select("id, email, role, status, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (inviteRes.error) {
    logger.error("invites.acceptInvite.lookup_failed", {
      err: inviteRes.error.message,
    });
    return internalError(inviteRes.error.message);
  }
  if (!inviteRes.data) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message:
          "This invite link is invalid. Request a new invite from your admin.",
      },
    };
  }

  const invite = inviteRes.data as {
    id: string;
    email: string;
    role: string;
    status: string;
    expires_at: string;
  };
  if (invite.status === "accepted") {
    return {
      ok: false,
      error: {
        code: "ALREADY_ACCEPTED",
        message: "This invite has already been accepted. Sign in normally.",
      },
    };
  }
  if (invite.status === "revoked" || invite.status === "expired") {
    return {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message:
          "This invite is no longer valid. Request a new invite from your admin.",
      },
    };
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return {
      ok: false,
      error: {
        code: "EXPIRED",
        message:
          "This invite has expired. Request a new invite from your admin.",
      },
    };
  }

  // 2. Create the auth.users row via Supabase admin API. The
  //    handle_new_auth_user trigger inserts opollo_users with
  //    role='user' (or 'super_admin' if this email is the
  //    first_admin_email). The accept_invite RPC will promote the role
  //    if the invite was for 'admin'.
  const createRes = await supabase.auth.admin.createUser({
    email: invite.email,
    password: input.password,
    email_confirm: true,
  });
  if (createRes.error || !createRes.data?.user) {
    // Email already registered? Rare — the createInvite ACTIVE_USER_EXISTS
    // check should have caught it. Still surface a clean error.
    const status = (createRes.error as { status?: number } | undefined)?.status;
    if (
      status === 422 ||
      /already (registered|exists)/i.test(createRes.error?.message ?? "")
    ) {
      return {
        ok: false,
        error: {
          code: "AUTH_CREATE_FAILED",
          message:
            "An account already exists for this email. Sign in instead.",
        },
      };
    }
    logger.error("invites.acceptInvite.auth_create_failed", {
      err: createRes.error?.message,
    });
    return {
      ok: false,
      error: {
        code: "AUTH_CREATE_FAILED",
        message:
          "Could not create your account. Try again or ask your admin for a fresh invite.",
      },
    };
  }
  const userId = createRes.data.user.id;

  // 3. Atomically: accept invite + promote role + write audit row.
  const acceptRes = await supabase.rpc("accept_invite", {
    p_invite_id: invite.id,
    p_user_id: userId,
    p_email: invite.email,
  });
  if (acceptRes.error) {
    logger.error("invites.acceptInvite.rpc_failed", {
      err: acceptRes.error.message,
      user_id: userId,
    });
    return internalError(acceptRes.error.message);
  }
  if (acceptRes.data !== true) {
    // Race: invite was accepted/revoked between lookup + RPC. The
    // user.users row exists but the audit didn't land. Recovery: the
    // user can sign in (auth works); the orphan invite row is what
    // it is.
    return {
      ok: false,
      error: {
        code: "ALREADY_ACCEPTED",
        message:
          "This invite was just accepted by another tab. Sign in normally.",
      },
    };
  }

  return {
    ok: true,
    user_id: userId,
    email: invite.email,
    role: invite.role as InviteRole,
  };
}

function internalError(message: string): {
  ok: false;
  error: { code: "INTERNAL_ERROR"; message: string };
} {
  return {
    ok: false,
    error: { code: "INTERNAL_ERROR", message },
  };
}
