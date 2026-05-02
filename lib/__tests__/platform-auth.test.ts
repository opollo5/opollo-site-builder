import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  canDo,
  currentUserCompanyId,
  getCurrentCompany,
  getCurrentPlatformSession,
  hasCompanyRole,
  isCompanyMember,
  isOpolloStaff,
  minRoleFor,
  roleSatisfies,
} from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, signInAs, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// P2-1: TypeScript wrappers around the SQL helpers from migration 0070.
//
// What this file proves:
//   1. Pure permissions logic — minRoleFor / roleSatisfies — exhaustive
//      across the role hierarchy and the action enum.
//   2. RPC pass-through helpers — isOpolloStaff / isCompanyMember /
//      hasCompanyRole / currentUserCompanyId — return the right values for
//      seeded users in seeded companies via a JWT-bearer client.
//   3. canDo composition — Opollo staff bypass; customer roles evaluated
//      against the action's minimum role.
//   4. getCurrentPlatformSession — resolves identity + company membership
//      cleanly; returns null for an authenticated user with no
//      platform_users row.
//
// The optional `client` parameter on every helper is what makes this
// testable: production calls go through createRouteAuthClient (cookie-bound,
// can't be simulated under vitest), tests pass a JWT-bearer client built
// from a seeded auth user. Both code paths converge on the same .rpc()
// against the SQL helpers, so the test exercises the actual logic.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "33333333-3333-3333-3333-333333333333";
const COMPANY_B_ID = "44444444-4444-4444-4444-444444444444";
const OPOLLO_INTERNAL_ID = "00000000-0000-0000-0000-000000000001";

function buildJwtClient(jwt: string): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

describe("lib/platform/auth — permissions logic (pure)", () => {
  it("minRoleFor maps every action to a CompanyRole", () => {
    expect(minRoleFor("manage_users")).toBe("admin");
    expect(minRoleFor("edit_company_settings")).toBe("admin");
    expect(minRoleFor("manage_connections")).toBe("admin");
    expect(minRoleFor("reconnect_connection")).toBe("admin");
    expect(minRoleFor("manage_invitations")).toBe("admin");
    expect(minRoleFor("receive_connection_alerts")).toBe("admin");

    expect(minRoleFor("approve_post")).toBe("approver");
    expect(minRoleFor("reject_post")).toBe("approver");
    expect(minRoleFor("schedule_post")).toBe("approver");

    expect(minRoleFor("create_post")).toBe("editor");
    expect(minRoleFor("edit_post")).toBe("editor");
    expect(minRoleFor("submit_for_approval")).toBe("editor");

    expect(minRoleFor("view_calendar")).toBe("viewer");
  });

  it("roleSatisfies — admin satisfies every minimum", () => {
    expect(roleSatisfies("admin", "admin")).toBe(true);
    expect(roleSatisfies("admin", "approver")).toBe(true);
    expect(roleSatisfies("admin", "editor")).toBe(true);
    expect(roleSatisfies("admin", "viewer")).toBe(true);
  });

  it("roleSatisfies — approver satisfies approver+editor+viewer, not admin", () => {
    expect(roleSatisfies("approver", "admin")).toBe(false);
    expect(roleSatisfies("approver", "approver")).toBe(true);
    expect(roleSatisfies("approver", "editor")).toBe(true);
    expect(roleSatisfies("approver", "viewer")).toBe(true);
  });

  it("roleSatisfies — editor satisfies editor+viewer, not approver/admin", () => {
    expect(roleSatisfies("editor", "admin")).toBe(false);
    expect(roleSatisfies("editor", "approver")).toBe(false);
    expect(roleSatisfies("editor", "editor")).toBe(true);
    expect(roleSatisfies("editor", "viewer")).toBe(true);
  });

  it("roleSatisfies — viewer satisfies only viewer", () => {
    expect(roleSatisfies("viewer", "admin")).toBe(false);
    expect(roleSatisfies("viewer", "approver")).toBe(false);
    expect(roleSatisfies("viewer", "editor")).toBe(false);
    expect(roleSatisfies("viewer", "viewer")).toBe(true);
  });
});

describe("lib/platform/auth — RPC + composition against live Supabase", () => {
  let staff: SeededAuthUser;
  let aAdmin: SeededAuthUser;
  let aApprover: SeededAuthUser;
  let aEditor: SeededAuthUser;
  let aViewer: SeededAuthUser;
  let bAdmin: SeededAuthUser;
  let unprovisioned: SeededAuthUser;

  let staffClient: SupabaseClient;
  let aAdminClient: SupabaseClient;
  let aApproverClient: SupabaseClient;
  let aEditorClient: SupabaseClient;
  let aViewerClient: SupabaseClient;
  let bAdminClient: SupabaseClient;
  let unprovisionedClient: SupabaseClient;

  beforeAll(async () => {
    staff = await seedAuthUser({
      email: "p2-staff@opollo.test",
      persistent: true,
    });
    aAdmin = await seedAuthUser({
      email: "p2-a-admin@opollo.test",
      persistent: true,
    });
    aApprover = await seedAuthUser({
      email: "p2-a-approver@opollo.test",
      persistent: true,
    });
    aEditor = await seedAuthUser({
      email: "p2-a-editor@opollo.test",
      persistent: true,
    });
    aViewer = await seedAuthUser({
      email: "p2-a-viewer@opollo.test",
      persistent: true,
    });
    bAdmin = await seedAuthUser({
      email: "p2-b-admin@opollo.test",
      persistent: true,
    });
    unprovisioned = await seedAuthUser({
      email: "p2-unprovisioned@opollo.test",
      persistent: true,
    });

    staffClient = buildJwtClient(await signInAs(staff));
    aAdminClient = buildJwtClient(await signInAs(aAdmin));
    aApproverClient = buildJwtClient(await signInAs(aApprover));
    aEditorClient = buildJwtClient(await signInAs(aEditor));
    aViewerClient = buildJwtClient(await signInAs(aViewer));
    bAdminClient = buildJwtClient(await signInAs(bAdmin));
    unprovisionedClient = buildJwtClient(await signInAs(unprovisioned));
  });

  beforeEach(async () => {
    // _setup.ts truncated platform_*. Re-seed companies + users + memberships.
    // PostgREST batch insert sends NULL for keys missing from any row in the
    // batch — spell every column on every row to avoid NOT NULL violations
    // (lesson from PR #376 fix-forward in #377).
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: OPOLLO_INTERNAL_ID,
          name: "Opollo",
          slug: "opollo",
          domain: null,
          is_opollo_internal: true,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "p2-acme",
          domain: "p2-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "p2-beta",
          domain: "p2-beta.test",
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
    if ((companies.data?.length ?? 0) !== 3) {
      throw new Error(
        `seed platform_companies: ${companies.data?.length ?? 0}/3 rows`,
      );
    }

    // Note: `unprovisioned` has an auth.users row but NO platform_users row,
    // by design — proves getCurrentPlatformSession returns null in that case.
    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: staff.id,
          email: staff.email,
          full_name: "Opollo Staff",
          is_opollo_staff: true,
        },
        {
          id: aAdmin.id,
          email: aAdmin.email,
          full_name: "A Admin",
          is_opollo_staff: false,
        },
        {
          id: aApprover.id,
          email: aApprover.email,
          full_name: "A Approver",
          is_opollo_staff: false,
        },
        {
          id: aEditor.id,
          email: aEditor.email,
          full_name: "A Editor",
          is_opollo_staff: false,
        },
        {
          id: aViewer.id,
          email: aViewer.email,
          full_name: "A Viewer",
          is_opollo_staff: false,
        },
        {
          id: bAdmin.id,
          email: bAdmin.email,
          full_name: "B Admin",
          is_opollo_staff: false,
        },
      ])
      .select("id");
    if (users.error) {
      throw new Error(
        `seed platform_users: ${users.error.code ?? "?"} ${users.error.message}`,
      );
    }
    if ((users.data?.length ?? 0) !== 6) {
      throw new Error(
        `seed platform_users: ${users.data?.length ?? 0}/6 rows`,
      );
    }

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: OPOLLO_INTERNAL_ID, user_id: staff.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: aAdmin.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: aApprover.id, role: "approver" },
        { company_id: COMPANY_A_ID, user_id: aEditor.id, role: "editor" },
        { company_id: COMPANY_A_ID, user_id: aViewer.id, role: "viewer" },
        { company_id: COMPANY_B_ID, user_id: bAdmin.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed platform_company_users: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }
    if ((memberships.data?.length ?? 0) !== 6) {
      throw new Error(
        `seed platform_company_users: ${memberships.data?.length ?? 0}/6 rows`,
      );
    }
  });

  afterAll(async () => {
    const supabase = getServiceRoleClient();
    for (const u of [
      staff,
      aAdmin,
      aApprover,
      aEditor,
      aViewer,
      bAdmin,
      unprovisioned,
    ]) {
      if (!u) continue;
      await supabase.auth.admin.deleteUser(u.id);
    }
  });

  describe("isOpolloStaff", () => {
    it("returns true for is_opollo_staff=true user", async () => {
      expect(await isOpolloStaff(staffClient)).toBe(true);
    });

    it("returns false for customer admin", async () => {
      expect(await isOpolloStaff(aAdminClient)).toBe(false);
    });

    it("returns false for unprovisioned user (no platform_users row)", async () => {
      expect(await isOpolloStaff(unprovisionedClient)).toBe(false);
    });
  });

  describe("isCompanyMember", () => {
    it("true for own company", async () => {
      expect(await isCompanyMember(COMPANY_A_ID, aAdminClient)).toBe(true);
    });

    it("false for other company", async () => {
      expect(await isCompanyMember(COMPANY_B_ID, aAdminClient)).toBe(false);
    });

    it("false for Opollo staff (not member of customer company A)", async () => {
      // Opollo staff are not company members of customer companies — they
      // bypass company-scoping via the is_opollo_staff() branch elsewhere.
      expect(await isCompanyMember(COMPANY_A_ID, staffClient)).toBe(false);
    });
  });

  describe("hasCompanyRole", () => {
    it("admin satisfies every minimum role in own company", async () => {
      for (const min of ["admin", "approver", "editor", "viewer"] as const) {
        expect(await hasCompanyRole(COMPANY_A_ID, min, aAdminClient)).toBe(
          true,
        );
      }
    });

    it("editor satisfies editor+viewer, not approver/admin", async () => {
      expect(await hasCompanyRole(COMPANY_A_ID, "admin", aEditorClient)).toBe(
        false,
      );
      expect(
        await hasCompanyRole(COMPANY_A_ID, "approver", aEditorClient),
      ).toBe(false);
      expect(await hasCompanyRole(COMPANY_A_ID, "editor", aEditorClient)).toBe(
        true,
      );
      expect(await hasCompanyRole(COMPANY_A_ID, "viewer", aEditorClient)).toBe(
        true,
      );
    });

    it("returns false for non-member of the queried company", async () => {
      expect(await hasCompanyRole(COMPANY_A_ID, "viewer", bAdminClient)).toBe(
        false,
      );
    });
  });

  describe("currentUserCompanyId", () => {
    it("returns the user's company id", async () => {
      expect(await currentUserCompanyId(aApproverClient)).toBe(COMPANY_A_ID);
    });

    it("returns null for unprovisioned user", async () => {
      expect(await currentUserCompanyId(unprovisionedClient)).toBeNull();
    });
  });

  describe("canDo (composition)", () => {
    it("Opollo staff can do every action in any company (override)", async () => {
      expect(await canDo(COMPANY_A_ID, "manage_users", staffClient)).toBe(
        true,
      );
      expect(await canDo(COMPANY_B_ID, "approve_post", staffClient)).toBe(
        true,
      );
      expect(await canDo(COMPANY_A_ID, "view_calendar", staffClient)).toBe(
        true,
      );
    });

    it("customer admin can manage users in own company, not company B", async () => {
      expect(await canDo(COMPANY_A_ID, "manage_users", aAdminClient)).toBe(
        true,
      );
      expect(await canDo(COMPANY_B_ID, "manage_users", aAdminClient)).toBe(
        false,
      );
    });

    it("approver can approve posts but not manage users", async () => {
      expect(await canDo(COMPANY_A_ID, "approve_post", aApproverClient)).toBe(
        true,
      );
      expect(await canDo(COMPANY_A_ID, "manage_users", aApproverClient)).toBe(
        false,
      );
    });

    it("editor can create_post + submit_for_approval, not approve_post", async () => {
      expect(await canDo(COMPANY_A_ID, "create_post", aEditorClient)).toBe(
        true,
      );
      expect(
        await canDo(COMPANY_A_ID, "submit_for_approval", aEditorClient),
      ).toBe(true);
      expect(await canDo(COMPANY_A_ID, "approve_post", aEditorClient)).toBe(
        false,
      );
    });

    it("viewer can only view_calendar", async () => {
      expect(await canDo(COMPANY_A_ID, "view_calendar", aViewerClient)).toBe(
        true,
      );
      expect(await canDo(COMPANY_A_ID, "create_post", aViewerClient)).toBe(
        false,
      );
      expect(await canDo(COMPANY_A_ID, "approve_post", aViewerClient)).toBe(
        false,
      );
    });

    it("unprovisioned user cannot do anything in any company", async () => {
      expect(
        await canDo(COMPANY_A_ID, "view_calendar", unprovisionedClient),
      ).toBe(false);
      expect(
        await canDo(COMPANY_A_ID, "manage_users", unprovisionedClient),
      ).toBe(false);
    });
  });

  describe("getCurrentPlatformSession + getCurrentCompany", () => {
    it("returns full session for customer admin", async () => {
      const session = await getCurrentPlatformSession(aAdminClient);
      expect(session).not.toBeNull();
      expect(session?.userId).toBe(aAdmin.id);
      expect(session?.email).toBe(aAdmin.email);
      expect(session?.isOpolloStaff).toBe(false);
      expect(session?.company).toEqual({
        companyId: COMPANY_A_ID,
        role: "admin",
      });
    });

    it("returns isOpolloStaff=true for staff with internal company membership", async () => {
      const session = await getCurrentPlatformSession(staffClient);
      expect(session).not.toBeNull();
      expect(session?.isOpolloStaff).toBe(true);
      expect(session?.company).toEqual({
        companyId: OPOLLO_INTERNAL_ID,
        role: "admin",
      });
    });

    it("returns null for authenticated user with no platform_users row", async () => {
      const session = await getCurrentPlatformSession(unprovisionedClient);
      expect(session).toBeNull();
    });

    it("getCurrentCompany returns the membership directly", async () => {
      const company = await getCurrentCompany(aEditorClient);
      expect(company).toEqual({ companyId: COMPANY_A_ID, role: "editor" });
    });
  });
});
