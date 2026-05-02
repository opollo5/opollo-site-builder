import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  defaultExpiry,
  generateRawToken,
  hashToken,
  INVITATION_TTL_MS,
  revokeInvitation,
  sendInvitation,
} from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// P2-2: invitation send + revoke (lib layer).
//
// Pure tokens.ts unit tests + integration tests against live Supabase for
// sendInvitation and revokeInvitation. Route handlers are not covered
// here — they're thin glue (parse → gate → call lib → respond) and the
// e2e Playwright suite covers the full request path in a later slice.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "55555555-5555-5555-5555-555555555555";
const COMPANY_B_ID = "66666666-6666-6666-6666-666666666666";

describe("lib/platform/invitations/tokens — pure helpers", () => {
  it("generateRawToken returns 64-char hex (32 bytes)", () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateRawToken is unique across calls", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });

  it("hashToken is deterministic and 64-char hex (sha256)", () => {
    const raw = "deadbeef".repeat(8);
    const h1 = hashToken(raw);
    const h2 = hashToken(raw);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken changes with input", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("defaultExpiry is now + 14 days (within tolerance)", () => {
    const fixedNow = new Date("2026-05-01T00:00:00.000Z");
    const expiry = new Date(defaultExpiry(fixedNow));
    const expected = fixedNow.getTime() + INVITATION_TTL_MS;
    expect(expiry.getTime()).toBe(expected);
  });
});

describe("lib/platform/invitations — send + revoke against live Supabase", () => {
  let inviter: SeededAuthUser;
  let existingMember: SeededAuthUser;

  beforeAll(async () => {
    inviter = await seedAuthUser({
      email: "p2-2-inviter@opollo.test",
      persistent: true,
    });
    existingMember = await seedAuthUser({
      email: "p2-2-existing-member@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    // Companies A + B (no Opollo internal needed for this slice).
    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "p2-2-acme",
          domain: "p2-2-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "p2-2-beta",
          domain: "p2-2-beta.test",
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
    if ((companies.data?.length ?? 0) !== 2) {
      throw new Error(
        `seed platform_companies: ${companies.data?.length ?? 0}/2 rows`,
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
        {
          id: existingMember.id,
          email: existingMember.email,
          full_name: "Already In",
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
        // existingMember is a member of B; testing send to companyA for
        // their email asserts the V1 "one user, one company" rule.
        {
          company_id: COMPANY_B_ID,
          user_id: existingMember.id,
          role: "viewer",
        },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed platform_company_users: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const supabase = getServiceRoleClient();
    for (const u of [inviter, existingMember]) {
      if (!u) continue;
      await supabase.auth.admin.deleteUser(u.id);
    }
  });

  describe("sendInvitation", () => {
    it("happy path — inserts row, returns raw token + invitation", async () => {
      const result = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "newhire@acme.test",
        role: "editor",
        invitedBy: inviter.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.invitation.company_id).toBe(COMPANY_A_ID);
      expect(result.invitation.email).toBe("newhire@acme.test");
      expect(result.invitation.role).toBe("editor");
      expect(result.invitation.status).toBe("pending");
      expect(result.invitation.invited_by).toBe(inviter.id);
      expect(result.invitation.accepted_at).toBeNull();
      expect(result.invitation.revoked_at).toBeNull();

      // Confirm the row hit the DB with the hashed token (not raw).
      const svc = getServiceRoleClient();
      const row = await svc
        .from("platform_invitations")
        .select("token_hash")
        .eq("id", result.invitation.id)
        .single();
      expect(row.error).toBeNull();
      expect(row.data?.token_hash).toBe(hashToken(result.rawToken));
      expect(row.data?.token_hash).not.toBe(result.rawToken);
    });

    it("normalises email — trims + lowercases", async () => {
      const result = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "  Mixed@Acme.Test  ",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.email).toBe("mixed@acme.test");
    });

    it("rejects missing-@ email with VALIDATION_FAILED", async () => {
      const result = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "not-an-email",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects email already a member of any company → ACTIVE_MEMBERSHIP_EXISTS", async () => {
      // existingMember is a member of company B.
      const result = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: existingMember.email,
        role: "editor",
        invitedBy: inviter.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ACTIVE_MEMBERSHIP_EXISTS");
    });

    it("rejects second pending invite for same email/company → PENDING_INVITE_EXISTS", async () => {
      const first = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "dup-target@acme.test",
        role: "editor",
        invitedBy: inviter.id,
      });
      expect(first.ok).toBe(true);

      const second = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "dup-target@acme.test",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("PENDING_INVITE_EXISTS");
    });

    it("allows re-invite after the prior is revoked", async () => {
      const first = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "renewable@acme.test",
        role: "editor",
        invitedBy: inviter.id,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const revoked = await revokeInvitation(first.invitation.id, inviter.id);
      expect(revoked.ok).toBe(true);

      const second = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "renewable@acme.test",
        role: "editor",
        invitedBy: inviter.id,
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.invitation.status).toBe("pending");
    });

    it("respects custom expiresAt override (test plumbing)", async () => {
      const customExpiry = new Date("2027-01-01T00:00:00.000Z").toISOString();
      const result = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "custom-expiry@acme.test",
        role: "viewer",
        invitedBy: inviter.id,
        expiresAt: customExpiry,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.invitation.expires_at).toBe(customExpiry);
    });
  });

  describe("revokeInvitation", () => {
    it("happy path — sets revoked_at + status='revoked'", async () => {
      const sent = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "to-revoke@acme.test",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      const result = await revokeInvitation(
        sent.invitation.id,
        inviter.id,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.invitation.status).toBe("revoked");
      expect(result.invitation.revoked_at).not.toBeNull();
    });

    it("returns NOT_FOUND for missing id", async () => {
      const result = await revokeInvitation(
        "00000000-0000-0000-0000-99999999dead",
        inviter.id,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns ALREADY_REVOKED on second revoke", async () => {
      const sent = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "double-revoke@acme.test",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      const first = await revokeInvitation(sent.invitation.id, inviter.id);
      expect(first.ok).toBe(true);

      const second = await revokeInvitation(sent.invitation.id, inviter.id);
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("ALREADY_REVOKED");
    });

    it("returns ALREADY_ACCEPTED if invitation has accepted_at set", async () => {
      const sent = await sendInvitation({
        companyId: COMPANY_A_ID,
        email: "already-accepted@acme.test",
        role: "viewer",
        invitedBy: inviter.id,
      });
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;

      // Simulate accept by writing accepted_at directly via service-role.
      const svc = getServiceRoleClient();
      const update = await svc
        .from("platform_invitations")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
        })
        .eq("id", sent.invitation.id);
      expect(update.error).toBeNull();

      const result = await revokeInvitation(sent.invitation.id, inviter.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("ALREADY_ACCEPTED");
    });
  });
});
