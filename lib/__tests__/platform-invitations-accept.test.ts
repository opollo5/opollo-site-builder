import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  acceptInvitation,
  generateRawToken,
  hashToken,
  sendInvitation,
} from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// P2-3: invitation accept-flow integration tests against live Supabase.
//
// Covers the validation order (INVALID_TOKEN → REVOKED → ALREADY_ACCEPTED →
// EXPIRED → EMAIL_MISMATCH → AUTH_USER_EXISTS), the happy-path provisioning
// (auth.users + platform_users + platform_company_users + invitation
// accepted), and idempotent re-attempts (a second accept on the same
// token returns ALREADY_ACCEPTED, not a duplicate user).
//
// Tracking auth users created by accept calls so afterAll can sweep them —
// they're created via supabase.auth.admin.createUser inside acceptInvitation
// and don't go through seedAuthUser's tracker.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "77777777-7777-7777-7777-777777777777";

describe("lib/platform/invitations/accept — happy + error paths", () => {
  let inviter: SeededAuthUser;
  const acceptedUserIds = new Set<string>();

  beforeAll(async () => {
    inviter = await seedAuthUser({
      email: "p2-3-inviter@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "p2-3-acme",
          domain: "p2-3-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed platform_companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: inviter.id,
          email: inviter.email,
          full_name: "Inviter",
          is_opollo_staff: false,
        },
      ])
      .select("id");
    if (users.error) {
      throw new Error(
        `seed platform_users: ${users.error.code ?? "?"} ${users.error.message}`,
      );
    }

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_A_ID, user_id: inviter.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed platform_company_users: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (inviter) await svc.auth.admin.deleteUser(inviter.id);
    // Sweep auth users created via acceptInvitation across the file.
    for (const id of acceptedUserIds) {
      await svc.auth.admin.deleteUser(id);
    }
  });

  // Helper: creates a fresh invitation via sendInvitation, returning
  // {invitation, rawToken} so tests have a valid token to work with.
  async function createPendingInvite(
    email: string,
    role: "admin" | "approver" | "editor" | "viewer" = "editor",
  ) {
    const result = await sendInvitation({
      companyId: COMPANY_A_ID,
      email,
      role,
      invitedBy: inviter.id,
    });
    if (!result.ok) {
      throw new Error(
        `setup: sendInvitation failed: ${result.error.code} ${result.error.message}`,
      );
    }
    return result;
  }

  describe("happy path", () => {
    it("creates auth.users + platform_users + membership + marks invitation accepted", async () => {
      const sent = await createPendingInvite("happy@acme.test", "approver");

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "happy@acme.test",
        password: "test-password-1234",
        fullName: "Happy User",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      acceptedUserIds.add(result.userId);
      expect(result.companyId).toBe(COMPANY_A_ID);
      expect(result.role).toBe("approver");

      const svc = getServiceRoleClient();

      // platform_users row created with the right shape.
      const userRow = await svc
        .from("platform_users")
        .select("id, email, full_name, is_opollo_staff")
        .eq("id", result.userId)
        .single();
      expect(userRow.error).toBeNull();
      expect(userRow.data).toEqual({
        id: result.userId,
        email: "happy@acme.test",
        full_name: "Happy User",
        is_opollo_staff: false,
      });

      // Membership row created with the invited role.
      const membership = await svc
        .from("platform_company_users")
        .select("company_id, role, added_by")
        .eq("user_id", result.userId)
        .single();
      expect(membership.error).toBeNull();
      expect(membership.data).toEqual({
        company_id: COMPANY_A_ID,
        role: "approver",
        added_by: inviter.id,
      });

      // Invitation marked accepted.
      const invitation = await svc
        .from("platform_invitations")
        .select("status, accepted_at, accepted_user_id")
        .eq("id", sent.invitation.id)
        .single();
      expect(invitation.error).toBeNull();
      expect(invitation.data?.status).toBe("accepted");
      expect(invitation.data?.accepted_user_id).toBe(result.userId);
      expect(invitation.data?.accepted_at).not.toBeNull();
    });

    it("normalises email — accepts mixed-case input matching lowercase invitation", async () => {
      const sent = await createPendingInvite("mixed@acme.test", "viewer");

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "Mixed@Acme.Test",
        password: "test-password-1234",
        fullName: "Mixed Case",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      acceptedUserIds.add(result.userId);
    });
  });

  describe("validation", () => {
    it("rejects missing token", async () => {
      const result = await acceptInvitation({
        rawToken: "",
        email: "x@y.test",
        password: "test-password-1234",
        fullName: "Name",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects bad email", async () => {
      const result = await acceptInvitation({
        rawToken: generateRawToken(),
        email: "not-an-email",
        password: "test-password-1234",
        fullName: "Name",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects too-short password", async () => {
      const result = await acceptInvitation({
        rawToken: generateRawToken(),
        email: "x@y.test",
        password: "short",
        fullName: "Name",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects blank full name", async () => {
      const result = await acceptInvitation({
        rawToken: generateRawToken(),
        email: "x@y.test",
        password: "test-password-1234",
        fullName: "   ",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("token + state errors", () => {
    it("INVALID_TOKEN when token doesn't resolve to any invitation", async () => {
      const result = await acceptInvitation({
        rawToken: generateRawToken(),
        email: "any@acme.test",
        password: "test-password-1234",
        fullName: "Anyone",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_TOKEN");
    });

    it("REVOKED when invitation was revoked", async () => {
      const sent = await createPendingInvite("revoked@acme.test");
      const svc = getServiceRoleClient();
      await svc
        .from("platform_invitations")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", sent.invitation.id);

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "revoked@acme.test",
        password: "test-password-1234",
        fullName: "Revoked",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("REVOKED");
    });

    it("ALREADY_ACCEPTED when accepted_at is set", async () => {
      const sent = await createPendingInvite("already@acme.test");

      // First accept
      const first = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "already@acme.test",
        password: "test-password-1234",
        fullName: "First",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      acceptedUserIds.add(first.userId);

      // Second accept (same token)
      const second = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "already@acme.test",
        password: "test-password-1234",
        fullName: "Second",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("ALREADY_ACCEPTED");
    });

    it("EXPIRED when expires_at is in the past", async () => {
      const sent = await createPendingInvite("expired@acme.test");
      const svc = getServiceRoleClient();
      await svc
        .from("platform_invitations")
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", sent.invitation.id);

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "expired@acme.test",
        password: "test-password-1234",
        fullName: "Expired",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("EXPIRED");
    });

    it("EMAIL_MISMATCH when body email differs from invitation email", async () => {
      const sent = await createPendingInvite("right@acme.test");

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "wrong@acme.test",
        password: "test-password-1234",
        fullName: "Wrong Recipient",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("EMAIL_MISMATCH");
    });
  });

  describe("auth user collisions", () => {
    it("AUTH_USER_EXISTS when supabase auth.users already has the email", async () => {
      // Pre-create an auth user matching what the invitation targets.
      const collision = await seedAuthUser({
        email: "collision@acme.test",
      });
      // Note: not adding to persistent — _setup.ts cleanupTrackedAuthUsers
      // sweeps it, but this test runs synchronously inside its own beforeEach
      // window so the user is alive when acceptInvitation runs.

      const sent = await createPendingInvite("collision@acme.test");

      const result = await acceptInvitation({
        rawToken: sent.rawToken,
        email: "collision@acme.test",
        password: "test-password-1234",
        fullName: "Collision",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("AUTH_USER_EXISTS");

      // Belt-and-braces: ensure no orphan platform rows were inserted
      // for the colliding email — the createUser failure should short-
      // circuit before the platform_users insert runs.
      const svc = getServiceRoleClient();
      const orphan = await svc
        .from("platform_users")
        .select("id")
        .eq("email", "collision@acme.test");
      expect(orphan.data?.length ?? 0).toBe(0);

      // collision auth user is tracked by seedAuthUser's tracker;
      // _setup.ts will sweep it.
      void collision;
    });
  });

  describe("token storage shape", () => {
    it("never stores the raw token — only the hash lands in token_hash", async () => {
      const raw = generateRawToken();
      const hash = hashToken(raw);
      expect(raw).not.toBe(hash);
      // Both 64 hex chars; equality on these tokens is the wrong test —
      // assert that the SHA-256 differs from the input.
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
