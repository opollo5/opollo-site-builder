import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getPlatformCompany } from "@/lib/platform/companies";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// P3-3 — getPlatformCompany lib helper.
//
// Loads company + members (with email + name from platform_users) +
// pending invitations. Asserts the three-fan-out shape, NOT_FOUND, and
// VALIDATION_FAILED on bad UUIDs.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COMPANY_B_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe("lib/platform/companies/get — getPlatformCompany", () => {
  let admin: SeededAuthUser;
  let editor: SeededAuthUser;

  beforeAll(async () => {
    admin = await seedAuthUser({
      email: "p3-3-admin@opollo.test",
      persistent: true,
    });
    editor = await seedAuthUser({
      email: "p3-3-editor@opollo.test",
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
          slug: "p3-3-acme",
          domain: "p3-3-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "p3-3-beta",
          domain: "p3-3-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: admin.id,
          email: admin.email,
          full_name: "Acme Admin",
          is_opollo_staff: false,
        },
        {
          id: editor.id,
          email: editor.email,
          full_name: "Acme Editor",
          is_opollo_staff: false,
        },
      ])
      .select("id");
    if (users.error) {
      throw new Error(
        `seed users: ${users.error.code ?? "?"} ${users.error.message}`,
      );
    }

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_A_ID, user_id: admin.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: editor.id, role: "editor" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed memberships: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }

    // Seed two pending invites + one accepted (which should NOT appear).
    const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const inviteSeed = await svc
      .from("platform_invitations")
      .insert([
        {
          company_id: COMPANY_A_ID,
          email: "pending1@acme.test",
          role: "viewer",
          token_hash: `hash-p3-3-1-${Date.now()}`,
          status: "pending",
          expires_at: expires,
          invited_by: admin.id,
        },
        {
          company_id: COMPANY_A_ID,
          email: "pending2@acme.test",
          role: "approver",
          token_hash: `hash-p3-3-2-${Date.now()}`,
          status: "pending",
          expires_at: expires,
          invited_by: admin.id,
        },
        {
          company_id: COMPANY_A_ID,
          email: "accepted@acme.test",
          role: "viewer",
          token_hash: `hash-p3-3-3-${Date.now()}`,
          status: "accepted",
          expires_at: expires,
          invited_by: admin.id,
          accepted_at: new Date().toISOString(),
        },
      ])
      .select("id");
    if (inviteSeed.error) {
      throw new Error(
        `seed invitations: ${inviteSeed.error.code ?? "?"} ${inviteSeed.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [admin, editor]) {
      if (!u) continue;
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  it("happy path — returns company + members + pending-only invitations", async () => {
    const result = await getPlatformCompany(COMPANY_A_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.company.id).toBe(COMPANY_A_ID);
    expect(result.data.company.name).toBe("Acme Co");

    expect(result.data.members).toHaveLength(2);
    const memberByRole = new Map(
      result.data.members.map((m) => [m.role, m]),
    );
    expect(memberByRole.get("admin")?.email).toBe(admin.email);
    expect(memberByRole.get("admin")?.full_name).toBe("Acme Admin");
    expect(memberByRole.get("editor")?.email).toBe(editor.email);

    // Only the two pending invitations; the accepted one is filtered.
    expect(result.data.pending_invitations).toHaveLength(2);
    const emails = result.data.pending_invitations.map((i) => i.email).sort();
    expect(emails).toEqual(["pending1@acme.test", "pending2@acme.test"]);
  });

  it("returns NOT_FOUND for a non-existent UUID", async () => {
    const result = await getPlatformCompany(
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_FAILED for a malformed id", async () => {
    const result = await getPlatformCompany("not-a-uuid");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("empty company has zero members + zero invitations", async () => {
    const result = await getPlatformCompany(COMPANY_B_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.members).toHaveLength(0);
    expect(result.data.pending_invitations).toHaveLength(0);
  });
});
