import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { seedAuthUser, signInAs, type SeededAuthUser } from "./_auth-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// 0070 — Platform Foundation: schema + RLS + helpers + seed.
//
// What this file proves:
//   1. The migration's seed inserts the Opollo internal company at the fixed
//      UUID 00000000-0000-0000-0000-000000000001.
//   2. Schema-layer invariants the app cannot bypass:
//        - UNIQUE (user_id) on platform_company_users (one user, one company).
//        - is_opollo_internal singleton index (one Opollo internal company).
//        - Pending-invitation uniqueness per (company_id, email).
//   3. Auth helper functions return correct values per signed-in role:
//        is_opollo_staff(), is_company_member(uuid),
//        has_company_role(uuid, role), current_user_company().
//   4. RLS isolates company A's data from company B's reader/writer, and
//      Opollo staff override sees both.
//
// Social-table RLS gets a smoke isolation case here; the full role × table
// matrix lands with the social feature code in S1+.
// ---------------------------------------------------------------------------

const OPOLLO_INTERNAL_ID = "00000000-0000-0000-0000-000000000001";
const COMPANY_A_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_B_ID = "22222222-2222-2222-2222-222222222222";

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe("0070 — platform foundation: schema, RLS, helpers, seed", () => {
  let opolloStaff: SeededAuthUser;
  let aAdmin: SeededAuthUser;
  let aApprover: SeededAuthUser;
  let aEditor: SeededAuthUser;
  let aViewer: SeededAuthUser;
  let bAdmin: SeededAuthUser;

  let opolloClient: SupabaseClient;
  let aAdminClient: SupabaseClient;
  let aApproverClient: SupabaseClient;
  let aEditorClient: SupabaseClient;
  let aViewerClient: SupabaseClient;
  let bAdminClient: SupabaseClient;

  beforeAll(async () => {
    // Persistent auth users — survive _setup.ts cleanupTrackedAuthUsers()
    // calls so the JWTs minted here stay valid across the file. afterAll
    // sweeps them.
    opolloStaff = await seedAuthUser({
      email: "p1-opollo@opollo.test",
      persistent: true,
    });
    aAdmin = await seedAuthUser({
      email: "p1-a-admin@opollo.test",
      persistent: true,
    });
    aApprover = await seedAuthUser({
      email: "p1-a-approver@opollo.test",
      persistent: true,
    });
    aEditor = await seedAuthUser({
      email: "p1-a-editor@opollo.test",
      persistent: true,
    });
    aViewer = await seedAuthUser({
      email: "p1-a-viewer@opollo.test",
      persistent: true,
    });
    bAdmin = await seedAuthUser({
      email: "p1-b-admin@opollo.test",
      persistent: true,
    });

    opolloClient = buildClient(await signInAs(opolloStaff));
    aAdminClient = buildClient(await signInAs(aAdmin));
    aApproverClient = buildClient(await signInAs(aApprover));
    aEditorClient = buildClient(await signInAs(aEditor));
    aViewerClient = buildClient(await signInAs(aViewer));
    bAdminClient = buildClient(await signInAs(bAdmin));
  });

  beforeEach(async () => {
    // _setup.ts TRUNCATEd platform_* / social_* tables. Re-seed the world.
    // Each insert is error-checked + thrown — silent failures here cascade
    // into FK and PGRST116 errors deep in the assertions, masking the root
    // cause. PR #376's CI uncovered this; do not regress to silent inserts.
    const svc = getServiceRoleClient();

    // PostgREST batch insert takes the UNION of keys across rows — any row
    // omitting a key the union mentions sends explicit NULL, violating
    // NOT NULL columns. Spell every column on every row.
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
          slug: "acme",
          domain: "acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "beta",
          domain: "beta.test",
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
        `seed platform_companies: inserted ${companies.data?.length ?? 0}/3 rows`,
      );
    }

    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: opolloStaff.id,
          email: opolloStaff.email,
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
        `seed platform_users: inserted ${users.data?.length ?? 0}/6 rows`,
      );
    }

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        {
          company_id: OPOLLO_INTERNAL_ID,
          user_id: opolloStaff.id,
          role: "admin",
        },
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
        `seed platform_company_users: inserted ${memberships.data?.length ?? 0}/6 rows`,
      );
    }
  });

  afterAll(async () => {
    // Persistent auth users were skipped by _setup.ts cleanup; sweep them
    // here so they don't leak into auth.users across test runs.
    const supabase = getServiceRoleClient();
    for (const u of [opolloStaff, aAdmin, aApprover, aEditor, aViewer, bAdmin]) {
      if (!u) continue;
      await supabase.auth.admin.deleteUser(u.id);
    }
  });

  // -------------------------------------------------------------------------
  // Seed assertions
  // -------------------------------------------------------------------------

  describe("seed", () => {
    it("migration file inserts the Opollo internal company at the fixed UUID", () => {
      const sqlPath = path.resolve(
        process.cwd(),
        "supabase/migrations/0070_platform_foundation.sql",
      );
      const sql = readFileSync(sqlPath, "utf8");
      expect(sql).toContain("00000000-0000-0000-0000-000000000001");
      expect(sql).toMatch(
        /INSERT INTO platform_companies[\s\S]+?'00000000-0000-0000-0000-000000000001'/,
      );
      expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    });

    it("seeded internal company is readable with the documented attributes", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc
        .from("platform_companies")
        .select("id, name, slug, is_opollo_internal, timezone")
        .eq("id", OPOLLO_INTERNAL_ID)
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({
        id: OPOLLO_INTERNAL_ID,
        name: "Opollo",
        slug: "opollo",
        is_opollo_internal: true,
        timezone: "Australia/Melbourne",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Schema-layer constraints
  // -------------------------------------------------------------------------

  describe("constraints", () => {
    it("UNIQUE (user_id) blocks one user belonging to two companies", async () => {
      const svc = getServiceRoleClient();
      const { error } = await svc.from("platform_company_users").insert({
        company_id: COMPANY_B_ID,
        user_id: aAdmin.id,
        role: "admin",
      });
      expect(error?.code).toBe("23505");
    });

    it("singleton index blocks a second is_opollo_internal=true row", async () => {
      const svc = getServiceRoleClient();
      const { error } = await svc.from("platform_companies").insert({
        name: "Fake Internal",
        slug: "fake-internal",
        is_opollo_internal: true,
      });
      expect(error?.code).toBe("23505");
    });

    it("pending-invite uniqueness blocks duplicate sends to same email/company", async () => {
      const svc = getServiceRoleClient();
      const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const first = await svc.from("platform_invitations").insert({
        company_id: COMPANY_A_ID,
        email: "newhire@acme.test",
        role: "editor",
        token_hash: `hash-first-${Date.now()}`,
        expires_at: expires,
      });
      expect(first.error).toBeNull();

      const second = await svc.from("platform_invitations").insert({
        company_id: COMPANY_A_ID,
        email: "newhire@acme.test",
        role: "editor",
        token_hash: `hash-second-${Date.now()}`,
        expires_at: expires,
      });
      expect(second.error?.code).toBe("23505");
    });

    it("expired/accepted/revoked invites do NOT block re-invitation", async () => {
      const svc = getServiceRoleClient();
      const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const first = await svc.from("platform_invitations").insert({
        company_id: COMPANY_A_ID,
        email: "rehire@acme.test",
        role: "editor",
        token_hash: `hash-rehire-1-${Date.now()}`,
        expires_at: expires,
        status: "expired",
      });
      expect(first.error).toBeNull();

      const second = await svc.from("platform_invitations").insert({
        company_id: COMPANY_A_ID,
        email: "rehire@acme.test",
        role: "editor",
        token_hash: `hash-rehire-2-${Date.now()}`,
        expires_at: expires,
      });
      expect(second.error).toBeNull();
    });

    it("auth.users delete cascades to platform_users", async () => {
      const supabase = getServiceRoleClient();
      const throwaway = await seedAuthUser({
        email: `p1-cascade-${Date.now()}@opollo.test`,
      });
      await supabase
        .from("platform_users")
        .insert({ id: throwaway.id, email: throwaway.email });

      await supabase.auth.admin.deleteUser(throwaway.id);

      const { data } = await supabase
        .from("platform_users")
        .select("id")
        .eq("id", throwaway.id);
      expect(data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // SQL helper functions
  // -------------------------------------------------------------------------

  describe("SQL helpers", () => {
    it("is_opollo_staff() = true for staff", async () => {
      const { data, error } = await opolloClient.rpc("is_opollo_staff");
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it("is_opollo_staff() = false for customer admin", async () => {
      const { data, error } = await aAdminClient.rpc("is_opollo_staff");
      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it("is_company_member() = true for own company, false for other", async () => {
      const own = await aAdminClient.rpc("is_company_member", {
        company: COMPANY_A_ID,
      });
      expect(own.error).toBeNull();
      expect(own.data).toBe(true);

      const other = await aAdminClient.rpc("is_company_member", {
        company: COMPANY_B_ID,
      });
      expect(other.error).toBeNull();
      expect(other.data).toBe(false);
    });

    it("has_company_role: admin satisfies every minimum", async () => {
      for (const role of ["admin", "approver", "editor", "viewer"] as const) {
        const { data, error } = await aAdminClient.rpc("has_company_role", {
          company: COMPANY_A_ID,
          min_role: role,
        });
        expect(error).toBeNull();
        expect(data).toBe(true);
      }
    });

    it("has_company_role: editor satisfies editor+viewer, not admin/approver", async () => {
      const cases: Array<[string, boolean]> = [
        ["admin", false],
        ["approver", false],
        ["editor", true],
        ["viewer", true],
      ];
      for (const [role, expected] of cases) {
        const { data } = await aEditorClient.rpc("has_company_role", {
          company: COMPANY_A_ID,
          min_role: role,
        });
        expect(data).toBe(expected);
      }
    });

    it("has_company_role: returns false when user is not a company member", async () => {
      const { data } = await bAdminClient.rpc("has_company_role", {
        company: COMPANY_A_ID,
        min_role: "viewer",
      });
      expect(data).toBe(false);
    });

    it("current_user_company() returns the user's company", async () => {
      const { data, error } = await aAdminClient.rpc("current_user_company");
      expect(error).toBeNull();
      expect(data).toBe(COMPANY_A_ID);
    });
  });

  // -------------------------------------------------------------------------
  // RLS — platform_companies
  // -------------------------------------------------------------------------

  describe("RLS — platform_companies", () => {
    it("company A admin reads own company", async () => {
      const { data } = await aAdminClient
        .from("platform_companies")
        .select("id")
        .eq("id", COMPANY_A_ID);
      expect(data).toEqual([{ id: COMPANY_A_ID }]);
    });

    it("company A admin filtered when reading company B", async () => {
      const { data, error } = await aAdminClient
        .from("platform_companies")
        .select("id")
        .eq("id", COMPANY_B_ID);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("Opollo staff reads every company", async () => {
      const { data } = await opolloClient
        .from("platform_companies")
        .select("id")
        .in("id", [OPOLLO_INTERNAL_ID, COMPANY_A_ID, COMPANY_B_ID]);
      expect(data).toHaveLength(3);
    });

    it("company A admin denied INSERT (write reserved for Opollo staff)", async () => {
      const { error } = await aAdminClient
        .from("platform_companies")
        .insert({ name: "Hostile", slug: "hostile" })
        .select();
      expect(error?.code).toBe("42501");
    });

    it("Opollo staff allowed INSERT", async () => {
      const { data, error } = await opolloClient
        .from("platform_companies")
        .insert({ name: "Charlie Co", slug: "charlie" })
        .select("id, name");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // RLS — platform_company_users
  // -------------------------------------------------------------------------

  describe("RLS — platform_company_users", () => {
    it("company A members can read own company's memberships", async () => {
      const { data } = await aEditorClient
        .from("platform_company_users")
        .select("user_id")
        .eq("company_id", COMPANY_A_ID);
      expect(data?.length).toBe(4);
    });

    it("company A admin filtered when reading company B's memberships", async () => {
      const { data } = await aAdminClient
        .from("platform_company_users")
        .select("user_id")
        .eq("company_id", COMPANY_B_ID);
      expect(data).toEqual([]);
    });

    it("company A editor denied UPDATE (admin-only write)", async () => {
      const { data, error } = await aEditorClient
        .from("platform_company_users")
        .update({ role: "approver" })
        .eq("user_id", aViewer.id)
        .select();
      // RLS USING fails → zero rows match → empty data, no error.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("company A admin can UPDATE a member's role within own company", async () => {
      const { data, error } = await aAdminClient
        .from("platform_company_users")
        .update({ role: "approver" })
        .eq("user_id", aEditor.id)
        .select("user_id, role");
      expect(error).toBeNull();
      expect(data).toEqual([{ user_id: aEditor.id, role: "approver" }]);
    });
  });

  // -------------------------------------------------------------------------
  // RLS — platform_invitations
  // -------------------------------------------------------------------------

  describe("RLS — platform_invitations", () => {
    it("company A admin can INSERT invitation for own company", async () => {
      const { data, error } = await aAdminClient
        .from("platform_invitations")
        .insert({
          company_id: COMPANY_A_ID,
          email: "newperson@acme.test",
          role: "editor",
          token_hash: `hash-rls-${Date.now()}`,
          expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          invited_by: aAdmin.id,
        })
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("company A editor denied INSERT (admin-only)", async () => {
      const { error } = await aEditorClient
        .from("platform_invitations")
        .insert({
          company_id: COMPANY_A_ID,
          email: "denied@acme.test",
          role: "editor",
          token_hash: `hash-deny-${Date.now()}`,
          expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        })
        .select();
      expect(error?.code).toBe("42501");
    });

    it("company A admin filtered when listing company B's invitations", async () => {
      const svc = getServiceRoleClient();
      await svc.from("platform_invitations").insert({
        company_id: COMPANY_B_ID,
        email: "secret@beta.test",
        role: "viewer",
        token_hash: `hash-secret-${Date.now()}`,
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });

      const { data } = await aAdminClient
        .from("platform_invitations")
        .select("email")
        .eq("company_id", COMPANY_B_ID);
      expect(data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // RLS — platform_notifications
  // -------------------------------------------------------------------------

  describe("RLS — platform_notifications", () => {
    it("user reads own notifications, filtered from peers", async () => {
      const svc = getServiceRoleClient();
      await svc.from("platform_notifications").insert([
        {
          user_id: aEditor.id,
          company_id: COMPANY_A_ID,
          type: "approval_requested",
          title: "Editor's notification",
        },
        {
          user_id: aAdmin.id,
          company_id: COMPANY_A_ID,
          type: "approval_requested",
          title: "Admin's notification",
        },
      ]);

      const { data: ownData } = await aEditorClient
        .from("platform_notifications")
        .select("title");
      expect(ownData?.map((r) => r.title)).toEqual(["Editor's notification"]);
    });

    it("user can mark own notification read", async () => {
      const svc = getServiceRoleClient();
      const { data: inserted } = await svc
        .from("platform_notifications")
        .insert({
          user_id: aEditor.id,
          company_id: COMPANY_A_ID,
          type: "post_published",
          title: "Mark me read",
        })
        .select("id")
        .single();

      const { data, error } = await aEditorClient
        .from("platform_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", inserted!.id)
        .select("id, read_at");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]?.read_at).not.toBeNull();
    });

    it("user filtered when updating someone else's notification", async () => {
      const svc = getServiceRoleClient();
      const { data: inserted } = await svc
        .from("platform_notifications")
        .insert({
          user_id: aAdmin.id,
          company_id: COMPANY_A_ID,
          type: "post_failed",
          title: "Not for editor",
        })
        .select("id")
        .single();

      const { data, error } = await aEditorClient
        .from("platform_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", inserted!.id)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // RLS — social table smoke (full matrix lives with feature code in S1+)
  // -------------------------------------------------------------------------

  describe("social tables — RLS smoke (full matrix lands with feature code in S1+)", () => {
    it("company A admin filtered from company B's posts", async () => {
      const svc = getServiceRoleClient();
      const { data: bPost } = await svc
        .from("social_post_master")
        .insert({
          company_id: COMPANY_B_ID,
          state: "draft",
          source_type: "manual",
          master_text: "Beta secret post",
        })
        .select("id")
        .single();

      const { data, error } = await aAdminClient
        .from("social_post_master")
        .select("id")
        .eq("id", bPost!.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("Opollo staff sees posts from every company", async () => {
      const svc = getServiceRoleClient();
      await svc.from("social_post_master").insert([
        {
          company_id: COMPANY_A_ID,
          state: "draft",
          source_type: "manual",
          master_text: "A post",
        },
        {
          company_id: COMPANY_B_ID,
          state: "draft",
          source_type: "manual",
          master_text: "B post",
        },
      ]);

      const { data } = await opolloClient
        .from("social_post_master")
        .select("company_id")
        .in("company_id", [COMPANY_A_ID, COMPANY_B_ID]);
      const companies = new Set((data ?? []).map((r) => r.company_id));
      expect(companies).toEqual(new Set([COMPANY_A_ID, COMPANY_B_ID]));
    });
  });
});
