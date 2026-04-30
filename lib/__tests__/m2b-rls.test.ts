import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  seedAuthUser,
  signInAs,
  type SeededAuthUser,
} from "./_auth-helpers";
import { randomPrefix, seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M2b — user-scoped RLS policy matrix tests.
//
// For every table × role combination, one positive assertion: the exact
// RLS-allowed outcome (row visible, error code, etc). Each test file owns
// 3 persistent auth users seeded in beforeAll; the global TRUNCATE in
// _setup.ts wipes opollo_users between tests so we re-insert the rows in
// beforeEach. The auth.users rows survive cleanup — persistent: true
// exempts them from cleanupTrackedAuthUsers().
//
// Role-scoped supabase-js clients are built once in beforeAll by attaching
// the user's access token as a Bearer header; those clients stay alive
// for the life of this file. Tokens are JWTs with a multi-hour expiry —
// long enough for a 2-minute test run.
//
// Expected RLS outcomes by op:
//   SELECT — denied rows are filtered out; empty response, no error.
//   INSERT — WITH CHECK failure raises 42501 / "new row violates
//            row-level security policy for table". PostgREST surfaces
//            this as an error object on .insert().
//   UPDATE — denied rows don't match the USING predicate, so .update()
//            returns an empty data array and no error — same shape as
//            "no rows matched". Callers distinguish via prior read.
//   DELETE — same as UPDATE.
// ---------------------------------------------------------------------------

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL + SUPABASE_ANON_KEY not in env");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe("M2b: user-scoped RLS policies", () => {
  let admin: SeededAuthUser;
  let operator: SeededAuthUser;
  let viewer: SeededAuthUser;
  let adminClient: SupabaseClient;
  let operatorClient: SupabaseClient;
  let viewerClient: SupabaseClient;

  beforeAll(async () => {
    admin = await seedAuthUser({
      email: "m2b-admin@opollo.test",
      role: "admin",
      persistent: true,
    });
    operator = await seedAuthUser({
      email: "m2b-operator@opollo.test",
      role: "admin",
      persistent: true,
    });
    viewer = await seedAuthUser({
      email: "m2b-viewer@opollo.test",
      role: "user",
      persistent: true,
    });

    adminClient = buildClient(await signInAs(admin));
    operatorClient = buildClient(await signInAs(operator));
    viewerClient = buildClient(await signInAs(viewer));
  });

  beforeEach(async () => {
    // Global _setup.ts's TRUNCATE opollo_users CASCADE wiped the fixture
    // rows (auth.users survives the truncate because opollo_config +
    // public tables only are swept). Re-seed so auth_role() resolves
    // them during this test's policy evaluations.
    const svc = getServiceRoleClient();
    await svc.from("opollo_users").insert([
      { id: admin.id, email: admin.email, role: "admin" },
      { id: operator.id, email: operator.email, role: "admin" },
      { id: viewer.id, email: viewer.email, role: "user" },
    ]);
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [admin, operator, viewer]) {
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  // -------------------------------------------------------------------
  // sites
  // -------------------------------------------------------------------

  describe("sites", () => {
    let siteId: string;
    beforeEach(async () => {
      const site = await seedSite();
      siteId = site.id;
    });

    it("admin SELECT: sees existing row", async () => {
      const { data, error } = await adminClient.from("sites").select("id");
      expect(error).toBeNull();
      expect(data?.some((r) => r.id === siteId)).toBe(true);
    });
    it("operator SELECT: sees existing row", async () => {
      const { data, error } = await operatorClient.from("sites").select("id");
      expect(error).toBeNull();
      expect(data?.some((r) => r.id === siteId)).toBe(true);
    });
    it("viewer SELECT: sees existing row", async () => {
      const { data, error } = await viewerClient.from("sites").select("id");
      expect(error).toBeNull();
      expect(data?.some((r) => r.id === siteId)).toBe(true);
    });

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient
        .from("sites")
        .insert({ name: "A", wp_url: "https://a.test", prefix: randomPrefix() });
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient
        .from("sites")
        .insert({ name: "O", wp_url: "https://o.test", prefix: randomPrefix() });
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient
        .from("sites")
        .insert({ name: "V", wp_url: "https://v.test", prefix: randomPrefix() });
      expect(error?.code).toBe("42501");
    });

    it("admin UPDATE: modifies row", async () => {
      const { data, error } = await adminClient
        .from("sites")
        .update({ name: "by-admin" })
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: modifies row", async () => {
      const { data, error } = await operatorClient
        .from("sites")
        .update({ name: "by-op" })
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient
        .from("sites")
        .update({ name: "by-viewer" })
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: removes row", async () => {
      const { data, error } = await adminClient
        .from("sites")
        .delete()
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: removes row", async () => {
      const { data, error } = await operatorClient
        .from("sites")
        .delete()
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient
        .from("sites")
        .delete()
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // design_systems / design_components / design_templates / pages share
  // the same two-policy shape — consolidated via a small matrix helper.
  // -------------------------------------------------------------------

  async function seedDS(): Promise<{ siteId: string; dsId: string }> {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("design_systems")
      .insert({
        site_id: site.id,
        version: 1,
        tokens_css: "",
        base_styles: "",
        status: "draft",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seedDS: ${error?.message}`);
    return { siteId: site.id, dsId: data.id };
  }

  describe("design_systems", () => {
    let dsId: string;
    beforeEach(async () => {
      dsId = (await seedDS()).dsId;
    });

    it("admin SELECT: sees row", async () => {
      const { data } = await adminClient.from("design_systems").select("id");
      expect(data?.some((r) => r.id === dsId)).toBe(true);
    });
    it("operator SELECT: sees row", async () => {
      const { data } = await operatorClient.from("design_systems").select("id");
      expect(data?.some((r) => r.id === dsId)).toBe(true);
    });
    it("viewer SELECT: sees row", async () => {
      const { data } = await viewerClient.from("design_systems").select("id");
      expect(data?.some((r) => r.id === dsId)).toBe(true);
    });

    it("admin UPDATE: allowed", async () => {
      const { data } = await adminClient
        .from("design_systems")
        .update({ notes: "a" })
        .eq("id", dsId)
        .select("id");
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: allowed", async () => {
      const { data } = await operatorClient
        .from("design_systems")
        .update({ notes: "o" })
        .eq("id", dsId)
        .select("id");
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: filtered — 0 rows", async () => {
      const { data, error } = await viewerClient
        .from("design_systems")
        .update({ notes: "v" })
        .eq("id", dsId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: allowed", async () => {
      const { data } = await adminClient
        .from("design_systems")
        .delete()
        .eq("id", dsId)
        .select("id");
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: allowed", async () => {
      const { data } = await operatorClient
        .from("design_systems")
        .delete()
        .eq("id", dsId)
        .select("id");
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: filtered — 0 rows", async () => {
      const { data } = await viewerClient
        .from("design_systems")
        .delete()
        .eq("id", dsId)
        .select("id");
      expect(data).toEqual([]);
    });

    it("viewer INSERT: denied via 42501", async () => {
      const site = await seedSite();
      const { error } = await viewerClient.from("design_systems").insert({
        site_id: site.id,
        version: 1,
        tokens_css: "",
        base_styles: "",
        status: "draft",
      });
      expect(error?.code).toBe("42501");
    });
    it("operator INSERT: allowed", async () => {
      const site = await seedSite();
      const { error } = await operatorClient.from("design_systems").insert({
        site_id: site.id,
        version: 1,
        tokens_css: "",
        base_styles: "",
        status: "draft",
      });
      expect(error).toBeNull();
    });
    it("admin INSERT: allowed", async () => {
      const site = await seedSite();
      const { error } = await adminClient.from("design_systems").insert({
        site_id: site.id,
        version: 1,
        tokens_css: "",
        base_styles: "",
        status: "draft",
      });
      expect(error).toBeNull();
    });
  });

  describe("design_components", () => {
    let dsId: string;
    beforeEach(async () => {
      dsId = (await seedDS()).dsId;
    });

    async function componentBody(name: string) {
      return {
        design_system_id: dsId,
        name,
        category: "hero",
        html_template: "<section></section>",
        css: ".ls-x{}",
        content_schema: { type: "object" },
      };
    }

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient
        .from("design_components")
        .insert(await componentBody("c-a"));
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient
        .from("design_components")
        .insert(await componentBody("c-o"));
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient
        .from("design_components")
        .insert(await componentBody("c-v"));
      expect(error?.code).toBe("42501");
    });

    it("viewer SELECT: can read", async () => {
      const svc = getServiceRoleClient();
      await svc.from("design_components").insert(await componentBody("seen"));
      const { data, error } = await viewerClient
        .from("design_components")
        .select("name");
      expect(error).toBeNull();
      expect(data?.some((r) => r.name === "seen")).toBe(true);
    });
    it("viewer UPDATE: filtered — 0 rows", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("design_components")
        .insert(await componentBody("upd"))
        .select("id")
        .single();
      const { data } = await viewerClient
        .from("design_components")
        .update({ usage_notes: "nope" })
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toEqual([]);
    });
    it("viewer DELETE: filtered — 0 rows", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("design_components")
        .insert(await componentBody("del"))
        .select("id")
        .single();
      const { data } = await viewerClient
        .from("design_components")
        .delete()
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toEqual([]);
    });
  });

  describe("design_templates", () => {
    let dsId: string;
    beforeEach(async () => {
      dsId = (await seedDS()).dsId;
    });

    async function templateBody(name: string) {
      return {
        design_system_id: dsId,
        page_type: "homepage",
        name,
        composition: [{ component: "x", content_source: "brief.x" }],
        required_fields: {},
      };
    }

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient
        .from("design_templates")
        .insert(await templateBody("t-a"));
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient
        .from("design_templates")
        .insert(await templateBody("t-o"));
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient
        .from("design_templates")
        .insert(await templateBody("t-v"));
      expect(error?.code).toBe("42501");
    });

    it("viewer SELECT: can read", async () => {
      const svc = getServiceRoleClient();
      await svc.from("design_templates").insert(await templateBody("seen"));
      const { data } = await viewerClient
        .from("design_templates")
        .select("name");
      expect(data?.some((r) => r.name === "seen")).toBe(true);
    });
    it("operator UPDATE: allowed", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("design_templates")
        .insert(await templateBody("upd"))
        .select("id")
        .single();
      const { data } = await operatorClient
        .from("design_templates")
        .update({ name: "renamed" })
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: filtered — 0 rows", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("design_templates")
        .insert(await templateBody("del"))
        .select("id")
        .single();
      const { data } = await viewerClient
        .from("design_templates")
        .delete()
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toEqual([]);
    });
  });

  describe("pages", () => {
    let siteId: string;
    let dsVersion: number;
    beforeEach(async () => {
      const seeded = await seedDS();
      siteId = seeded.siteId;
      dsVersion = 1;
    });

    function pageBody(wp_page_id: number) {
      return {
        site_id: siteId,
        wp_page_id,
        slug: `slug-${wp_page_id}`,
        title: `T${wp_page_id}`,
        page_type: "homepage",
        design_system_version: dsVersion,
      };
    }

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient.from("pages").insert(pageBody(101));
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient.from("pages").insert(pageBody(102));
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient.from("pages").insert(pageBody(103));
      expect(error?.code).toBe("42501");
    });

    it("viewer SELECT: can read", async () => {
      const svc = getServiceRoleClient();
      await svc.from("pages").insert(pageBody(201));
      const { data } = await viewerClient
        .from("pages")
        .select("wp_page_id");
      expect(data?.some((r) => r.wp_page_id === 201)).toBe(true);
    });
    it("viewer UPDATE: filtered — 0 rows", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("pages")
        .insert(pageBody(202))
        .select("id")
        .single();
      const { data } = await viewerClient
        .from("pages")
        .update({ title: "nope" })
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toEqual([]);
    });
    it("viewer DELETE: filtered — 0 rows", async () => {
      const svc = getServiceRoleClient();
      const { data: seeded } = await svc
        .from("pages")
        .insert(pageBody(203))
        .select("id")
        .single();
      const { data } = await viewerClient
        .from("pages")
        .delete()
        .eq("id", seeded!.id)
        .select("id");
      expect(data).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // opollo_users — self-read carve-out, admin-only writes
  // -------------------------------------------------------------------

  describe("opollo_users", () => {
    it("admin SELECT: sees every row", async () => {
      const { data, error } = await adminClient
        .from("opollo_users")
        .select("id, email, role");
      expect(error).toBeNull();
      const emails = (data ?? []).map((r) => r.email);
      expect(emails).toEqual(
        expect.arrayContaining([admin.email, operator.email, viewer.email]),
      );
    });

    it("operator SELECT: sees only self", async () => {
      const { data, error } = await operatorClient
        .from("opollo_users")
        .select("id, email");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(operator.id);
    });

    it("viewer SELECT: sees only self", async () => {
      const { data, error } = await viewerClient
        .from("opollo_users")
        .select("id, email");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(viewer.id);
    });

    it("admin UPDATE: can promote another user", async () => {
      const { data, error } = await adminClient
        .from("opollo_users")
        .update({ role: "admin" })
        .eq("id", viewer.id)
        .select("id, role");
      expect(error).toBeNull();
      expect(data?.[0]?.role).toBe("admin");
    });

    it("operator UPDATE: filtered — no admin_write policy matches", async () => {
      const { data, error } = await operatorClient
        .from("opollo_users")
        .update({ role: "admin" })
        .eq("id", operator.id)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("viewer UPDATE: filtered — no admin_write policy matches", async () => {
      const { data, error } = await viewerClient
        .from("opollo_users")
        .update({ role: "admin" })
        .eq("id", viewer.id)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("operator DELETE: filtered — 0 rows", async () => {
      const { data } = await operatorClient
        .from("opollo_users")
        .delete()
        .eq("id", viewer.id)
        .select("id");
      expect(data).toEqual([]);
    });

    // admin DELETE not tested — cascades to auth.users via FK ON DELETE
    // CASCADE, and the fixture user whose row we'd delete is needed for
    // subsequent tests. Covered conceptually by the admin UPDATE test
    // above — same policy gate.
  });

  // -------------------------------------------------------------------
  // opollo_config — internal; no user-scoped policy → always empty from
  // authenticated context.
  // -------------------------------------------------------------------

  describe("opollo_config", () => {
    beforeEach(async () => {
      const svc = getServiceRoleClient();
      await svc
        .from("opollo_config")
        .upsert({ key: "first_admin_email", value: "someone@opollo.test" });
    });

    it("service-role reads the row", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc
        .from("opollo_config")
        .select("key, value")
        .eq("key", "first_admin_email")
        .maybeSingle();
      expect(error).toBeNull();
      expect(data?.value).toBe("someone@opollo.test");
    });

    it("authenticated user (admin) gets empty result set", async () => {
      const { data, error } = await adminClient
        .from("opollo_config")
        .select("key, value");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
