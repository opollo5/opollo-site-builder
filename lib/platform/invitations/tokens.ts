import "server-only";

import { createHash, randomBytes } from "node:crypto";

// 32-byte random tokens, hex-encoded for the URL. SHA-256 hex hash for
// storage. Same shape as lib/invites.ts (operator-side P3.2) so the two
// invite systems stay consistent.
//
// The raw token is returned to the caller (for the email body) and never
// stored. Only the hash lands in platform_invitations.token_hash. A
// leaked token grants exactly one approval-bound action (accept this
// specific invitation) and can be revoked at any time.

const TOKEN_BYTES = 32;
// V1 default: 14 days (per BUILD.md "Defaults"). Caller can override
// for testing.
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function defaultExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITATION_TTL_MS).toISOString();
}
