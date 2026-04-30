import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { hashIp } from "./cookies";

// ---------------------------------------------------------------------------
// AUTH-FOUNDATION P4.1 — Login challenge lifecycle.
//
// Four operations:
//
//   - createLoginChallenge() — called from the login server action
//     after password validation succeeds and the user has no matching
//     trusted device. Generates a 32-byte raw token + a fresh
//     device_id; INSERTs a login_challenges row; returns the
//     challenge_id (the row id, used in the URL) + the raw token (for
//     the email body) + the device_id (for the eventual cookie write).
//
//   - lookupChallengeByToken() — called from the /auth/approve page.
//     Hashes the incoming raw token + matches against token_hash.
//     Returns the row + its current state so the page can render the
//     right error (invalid / expired / already-used).
//
//   - approveChallenge() — flips status pending → approved + records
//     approved_at. Single-use: the second click on the same approval
//     link returns CONSUMED.
//
//   - consumeChallenge() — flips status approved → consumed. Called
//     by the complete-login API after the session cookie + (optional)
//     trusted_devices row land. Idempotent: returns false on a
//     second consume.
//
// All operations are Postgres-side; supabase-js doesn't expose
// transactions, but each operation is a single UPDATE WHERE status=...
// so concurrent attempts collapse to a single winner via row-level
// CAS.
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export interface CreateChallengeInput {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface CreateChallengeResult {
  ok: true;
  challenge_id: string;
  device_id: string;
  raw_token: string;
  expires_at: string;
}

export type CreateChallengeOutcome =
  | CreateChallengeResult
  | { ok: false; error: { code: "INTERNAL_ERROR"; message: string } };

export async function createLoginChallenge(
  input: CreateChallengeInput,
): Promise<CreateChallengeOutcome> {
  const supabase = getServiceRoleClient();
  const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const deviceId = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from("login_challenges")
    .insert({
      user_id: input.userId,
      device_id: deviceId,
      token_hash: tokenHash,
      ip_hash: hashIp(input.ip),
      ua_string: input.userAgent,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    logger.error("2fa.challenges.create_failed", {
      err: error?.message,
      user_id: input.userId,
    });
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error?.message ?? "Failed to create login challenge.",
      },
    };
  }

  return {
    ok: true,
    challenge_id: data.id as string,
    device_id: deviceId,
    raw_token: rawToken,
    expires_at: expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export interface ChallengeRow {
  id: string;
  user_id: string;
  device_id: string;
  status: "pending" | "approved" | "expired" | "consumed";
  ua_string: string | null;
  ip_hash: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
}

export async function lookupChallengeById(
  challengeId: string,
): Promise<ChallengeRow | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("login_challenges")
    .select(
      "id, user_id, device_id, status, ua_string, ip_hash, created_at, expires_at, approved_at",
    )
    .eq("id", challengeId)
    .maybeSingle();
  if (error) {
    logger.error("2fa.challenges.lookup_by_id_failed", { err: error.message });
    return null;
  }
  return (data as ChallengeRow | null) ?? null;
}

export async function lookupChallengeByToken(
  rawToken: string,
): Promise<ChallengeRow | null> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("login_challenges")
    .select(
      "id, user_id, device_id, status, ua_string, ip_hash, created_at, expires_at, approved_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    logger.error("2fa.challenges.lookup_by_token_failed", { err: error.message });
    return null;
  }
  return (data as ChallengeRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// State transitions (CAS-protected)
// ---------------------------------------------------------------------------

export type ApproveResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "expired" | "already_consumed" | "already_approved";
    };

export async function approveChallenge(challengeId: string): Promise<ApproveResult> {
  const supabase = getServiceRoleClient();
  const row = await lookupChallengeById(challengeId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "consumed") return { ok: false, reason: "already_consumed" };
  if (row.status === "approved") return { ok: false, reason: "already_approved" };
  if (row.status === "expired") return { ok: false, reason: "expired" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    // Best-effort flip to expired so polling sees the right state.
    await supabase
      .from("login_challenges")
      .update({ status: "expired" })
      .eq("id", challengeId)
      .eq("status", "pending");
    return { ok: false, reason: "expired" };
  }

  const { error, data } = await supabase
    .from("login_challenges")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", challengeId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    return {
      ok: false,
      reason: "not_found",
    };
  }
  if (!data || data.length === 0) {
    // Race: another tab consumed/expired between lookup + update.
    return { ok: false, reason: "already_consumed" };
  }
  return { ok: true };
}

export type ConsumeResult =
  | { ok: true; challenge: ChallengeRow }
  | { ok: false; reason: "not_found" | "expired" | "not_approved" | "already_consumed" };

export async function consumeChallenge(
  challengeId: string,
): Promise<ConsumeResult> {
  const supabase = getServiceRoleClient();
  const row = await lookupChallengeById(challengeId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "consumed") return { ok: false, reason: "already_consumed" };
  if (row.status !== "approved") return { ok: false, reason: "not_approved" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const { error, data } = await supabase
    .from("login_challenges")
    .update({ status: "consumed" })
    .eq("id", challengeId)
    .eq("status", "approved")
    .select("id");

  if (error) {
    return { ok: false, reason: "not_found" };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: "already_consumed" };
  }
  return { ok: true, challenge: { ...row, status: "consumed" } };
}

// ---------------------------------------------------------------------------
// Rate-limit helper: count active challenges for an email in the last hour.
// Used by the login server action before issuing a new challenge.
// ---------------------------------------------------------------------------

export async function recentChallengeCountForUser(userId: string): Promise<number> {
  const supabase = getServiceRoleClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("login_challenges")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  if (error) {
    logger.error("2fa.challenges.rate_count_failed", { err: error.message });
    return 0;
  }
  return count ?? 0;
}
