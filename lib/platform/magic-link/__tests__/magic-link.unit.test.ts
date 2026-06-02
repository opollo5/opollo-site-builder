import { describe, expect, it } from "vitest";

import type { ConsumeResult, MagicLink, ValidateResult } from "../types";
import { LINK_TTL_MS, SESSION_TTL_MS } from "../types";

// ---------------------------------------------------------------------------
// Unit tests for the magic-link state machine. No DB required.
// Tests the TTL constants and result-type exhaustiveness.
// ---------------------------------------------------------------------------

describe("LINK_TTL_MS / SESSION_TTL_MS constants", () => {
  it("approval link TTL is 24h", () => {
    expect(LINK_TTL_MS.approval).toBe(24 * 60 * 60 * 1000);
  });

  it("approval session TTL is 23h (same-day, ≤24h)", () => {
    expect(SESSION_TTL_MS.approval).toBe(23 * 60 * 60 * 1000);
  });

  it("login link TTL is 15 minutes", () => {
    expect(LINK_TTL_MS.login).toBe(15 * 60 * 1000);
  });

  it("login session TTL is 0 (delegates to Supabase session)", () => {
    expect(SESSION_TTL_MS.login).toBe(0);
  });

  it("reconnect session TTL is 2h", () => {
    expect(SESSION_TTL_MS.reconnect).toBe(2 * 60 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// State-machine logic: simulate the validate / consume conditions
// without hitting the database. These verify the INTENDED behaviour
// of the service functions; the integration tests verify the DB writes.
// ---------------------------------------------------------------------------

function makeMagicLink(
  overrides: Partial<MagicLink> = {},
): MagicLink {
  const base: MagicLink = {
    id: "00000000-0000-0000-0000-000000000001",
    purpose: "approval",
    token_hash: "a".repeat(64),
    subject_type: "approval_recipient",
    subject_id: "00000000-0000-0000-0000-000000000002",
    company_id: "00000000-0000-0000-0000-000000000003",
    email: "reviewer@example.com",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
    session_expires_at: null,
    revoked_at: null,
    regenerated_from: null,
    created_at: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

function applyValidateLogic(link: MagicLink, now = Date.now()): ValidateResult {
  if (link.revoked_at) return { valid: false, reason: "revoked" };

  if (link.consumed_at) {
    const sessionOk =
      link.session_expires_at &&
      new Date(link.session_expires_at).getTime() > now;
    if (!sessionOk) return { valid: false, reason: "session_expired" };
    return { valid: true, link, sessionActive: true };
  }

  if (new Date(link.expires_at).getTime() <= now) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, link, sessionActive: false };
}

describe("validate logic — state machine", () => {
  it("valid: unconsumed + not expired", () => {
    const link = makeMagicLink();
    const r = applyValidateLogic(link);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.sessionActive).toBe(false);
  });

  it("invalid: revoked_at set", () => {
    const link = makeMagicLink({ revoked_at: new Date().toISOString() });
    expect(applyValidateLogic(link)).toMatchObject({ valid: false, reason: "revoked" });
  });

  it("invalid: expires_at in the past (never consumed)", () => {
    const link = makeMagicLink({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(applyValidateLogic(link)).toMatchObject({ valid: false, reason: "expired" });
  });

  it("valid: consumed + active session", () => {
    const now = Date.now();
    const link = makeMagicLink({
      consumed_at: new Date(now - 1000).toISOString(),
      session_expires_at: new Date(now + 60_000).toISOString(),
    });
    const r = applyValidateLogic(link, now);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.sessionActive).toBe(true);
  });

  it("invalid: consumed + session expired", () => {
    const now = Date.now();
    const link = makeMagicLink({
      consumed_at: new Date(now - 2000).toISOString(),
      session_expires_at: new Date(now - 1000).toISOString(),
    });
    expect(applyValidateLogic(link, now)).toMatchObject({
      valid: false,
      reason: "session_expired",
    });
  });

  it("invalid: consumed + session_expires_at is null (login purpose)", () => {
    const now = Date.now();
    const link = makeMagicLink({
      purpose: "login",
      consumed_at: new Date(now - 1000).toISOString(),
      session_expires_at: null,
    });
    expect(applyValidateLogic(link, now)).toMatchObject({
      valid: false,
      reason: "session_expired",
    });
  });
});
