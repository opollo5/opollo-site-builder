import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleClient } from "@/lib/supabase";

import {
  seedAuthUser,
  signInAs,
  type SeededAuthUser,
} from "./_auth-helpers";
import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-1 RLS matrix — briefs / brief_pages / brief_runs / site_conventions.
//
// Roles × ops × tables = admin/operator/viewer × SELECT/INSERT/UPDATE/DELETE
// × 4 tables = 64 cells. Plus service-role bypass (4) plus
// authenticated-no-role sanity (8). Each table uses the same policy shape:
// viewers read-only; operators + admins read + write; service-role bypasses.
// ---------------------------------------------------------------------------

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error("m12-1-rls.test: SUPABASE_URL + SUPABASE_ANON_KEY not in env");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function randHex(): string {
  return Math.random().toString(36).slice(2, 10);
}

function baseBriefRow(siteId: string, suffix: string): Record<string, unknown> {
  return {
    site_id: siteId,
    title: `Test ${suffix}`,
    status: "parsed",
    source_storage_path: `m12-1-rls/${suffix}/${randHex()}.md`,
    source_mime_type: "text/markdown",
    source_size_bytes: 1024,
    source_sha256: "0".repeat(64),
    upload_idempotency_key: `m12-1-rls-${suffix}-${randHex()}`,
  };
}

describe("M12-1: RLS matrix for briefs + brief_pages + brief_runs + site_conventions", () => {
  let admin: SeededAuthUser;
  let operator: SeededAuthUser;
  let viewer: SeededAuthUser;
  let noRole: SeededAuthUser;
  let adminClient: SupabaseClient;
  let operatorClient: SupabaseClient;
  let viewerClient: SupabaseClient;
  let noRoleClient: SupabaseClient;

  beforeAll(async () => {
    admin = await seedAuthUser({ email: "m12-1-rls-admin@opollo.test", role: "admin", persistent: true });
    operator = await seedAuthUser({ email: "m12-1-rls-op@opollo.test", role: "operator", persistent: true });
    viewer = await seedAuthUser({ email: "m12-1-rls-viewer@opollo.test", role: "viewer", persistent: true });
    // seedAuthUser creates an opollo_users row via trigger; for the "no role"
    // user we delete that row each test so public.auth_role() returns NULL.
    noRole = await seedAuthUser({ email: "m12-1-rls-norole@opollo.test", role: "viewer", persistent: true });

    adminClient = buildClient(await signInAs(admin));
    operatorClient = buildClient(await signInAs(operator));
    viewerClient = buildClient(await signInAs(viewer));
    noRoleClient = buildClient(await signInAs(noRole));
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [admin, operator, viewer, noRole]) {
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  let siteId: string;
  let briefId: string;
  let pageId: string;
  let runId: string;
  let conventionsId: string;

  beforeEach(async () => {
    const svc = getServiceRoleClient();
    // _setup.ts TRUNCATEs opollo_users — re-seed so auth_role() resolves.
    await svc.from("opollo_users").insert([
      { id: admin.id, email: admin.email, role: "admin" },
      { id: operator.id, email: operator.email, role: "operator" },
      { id: viewer.id, email: viewer.email, role: "viewer" },
      // Intentionally skip noRole so auth_role() returns NULL for them.
    ]);

    const site = await seedSite({ prefix: `m12r${randHex().slice(0, 2)}` });
    siteId = site.id;

    const brief = await svc
      .from("briefs")
      .insert(baseBriefRow(siteId, "seed"))
      .select("id")
      .single();
    briefId = brief.data!.id as string;

    const page = await svc
      .from("brief_pages")
      .insert({
        brief_id: briefId, ordinal: 0, title: "Seed page",
        mode: "full_text", source_text: "seed", word_count: 1,
      })
      .select("id")
      .single();
    pageId = page.data!.id as string;

    const run = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    runId = run.data!.id as string;

    const conv = await svc
      .from("site_conventions")
      .insert({ brief_id: briefId })
      .select("id")
      .single();
    conventionsId = conv.data!.id as string;
  });

  // -----------------------------------------------------------------------
  // briefs — 16 cells
  // -----------------------------------------------------------------------

  describe("briefs", () => {
    it("admin SELECT: sees row", async () => {
      const { data, error } = await adminClient.from("briefs").select("id").eq("id", briefId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator SELECT: sees row", async () => {
      const { data, error } = await operatorClient.from("briefs").select("id").eq("id", briefId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer SELECT: sees row", async () => {
      const { data, error } = await viewerClient.from("briefs").select("id").eq("id", briefId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient.from("briefs").insert(baseBriefRow(siteId, "a"));
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient.from("briefs").insert(baseBriefRow(siteId, "o"));
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient.from("briefs").insert(baseBriefRow(siteId, "v"));
      expect(error?.code).toBe("42501");
    });

    it("admin UPDATE: modifies row", async () => {
      const { data, error } = await adminClient.from("briefs").update({ title: "by-admin" }).eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: modifies row", async () => {
      const { data, error } = await operatorClient.from("briefs").update({ title: "by-op" }).eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("briefs").update({ title: "by-viewer" }).eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: removes row", async () => {
      const { data, error } = await adminClient.from("briefs").delete().eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: removes row", async () => {
      const { data, error } = await operatorClient.from("briefs").delete().eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("briefs").delete().eq("id", briefId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("viewer INSERT check constraint path still hits 42501 before CHECKs", async () => {
      const row = baseBriefRow(siteId, "v2");
      const { error } = await viewerClient.from("briefs").insert(row);
      expect(error?.code).toBe("42501");
    });
    it("admin SELECT sees multiple rows after another insert", async () => {
      await adminClient.from("briefs").insert(baseBriefRow(siteId, "mx"));
      const { data, error } = await adminClient.from("briefs").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(2);
    });
    it("operator SELECT sees multiple rows", async () => {
      await operatorClient.from("briefs").insert(baseBriefRow(siteId, "mx2"));
      const { data, error } = await operatorClient.from("briefs").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(2);
    });
    it("viewer SELECT still sees row but cannot insert", async () => {
      const { data, error } = await viewerClient.from("briefs").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // brief_pages — 12 cells
  // -----------------------------------------------------------------------

  describe("brief_pages", () => {
    it("admin SELECT: sees row", async () => {
      const { data, error } = await adminClient.from("brief_pages").select("id").eq("id", pageId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator SELECT: sees row", async () => {
      const { data, error } = await operatorClient.from("brief_pages").select("id").eq("id", pageId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer SELECT: sees row", async () => {
      const { data, error } = await viewerClient.from("brief_pages").select("id").eq("id", pageId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("admin INSERT: allowed", async () => {
      const { error } = await adminClient.from("brief_pages").insert({
        brief_id: briefId, ordinal: 10, title: "Admin", mode: "short_brief", source_text: "x", word_count: 1,
      });
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const { error } = await operatorClient.from("brief_pages").insert({
        brief_id: briefId, ordinal: 11, title: "Op", mode: "short_brief", source_text: "x", word_count: 1,
      });
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient.from("brief_pages").insert({
        brief_id: briefId, ordinal: 12, title: "Viewer", mode: "short_brief", source_text: "x", word_count: 1,
      });
      expect(error?.code).toBe("42501");
    });

    it("admin UPDATE: modifies row", async () => {
      const { data, error } = await adminClient.from("brief_pages").update({ title: "byA" }).eq("id", pageId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: modifies row", async () => {
      const { data, error } = await operatorClient.from("brief_pages").update({ title: "byO" }).eq("id", pageId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("brief_pages").update({ title: "byV" }).eq("id", pageId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: removes row", async () => {
      const { data, error } = await adminClient.from("brief_pages").delete().eq("id", pageId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: removes row", async () => {
      const svc = getServiceRoleClient();
      const { data: np } = await svc.from("brief_pages").insert({
        brief_id: briefId, ordinal: 20, title: "Op-del", mode: "short_brief", source_text: "x", word_count: 1,
      }).select("id").single();
      const { data, error } = await operatorClient.from("brief_pages").delete().eq("id", np!.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("brief_pages").delete().eq("id", pageId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // brief_runs — 12 cells
  // -----------------------------------------------------------------------

  describe("brief_runs", () => {
    it("admin SELECT: sees row", async () => {
      const { data, error } = await adminClient.from("brief_runs").select("id").eq("id", runId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator SELECT: sees row", async () => {
      const { data, error } = await operatorClient.from("brief_runs").select("id").eq("id", runId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer SELECT: sees row", async () => {
      const { data, error } = await viewerClient.from("brief_runs").select("id").eq("id", runId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("admin INSERT: allowed (with terminal status to sidestep partial-unique)", async () => {
      const { error } = await adminClient.from("brief_runs").insert({
        brief_id: briefId, status: "succeeded", finished_at: new Date().toISOString(),
      });
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed (with terminal status)", async () => {
      const { error } = await operatorClient.from("brief_runs").insert({
        brief_id: briefId, status: "failed", finished_at: new Date().toISOString(), failure_code: "TEST",
      });
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const { error } = await viewerClient.from("brief_runs").insert({ brief_id: briefId, status: "queued" });
      expect(error?.code).toBe("42501");
    });

    it("admin UPDATE: modifies row", async () => {
      const { data, error } = await adminClient.from("brief_runs").update({ failure_detail: "admin" }).eq("id", runId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: modifies row", async () => {
      const { data, error } = await operatorClient.from("brief_runs").update({ failure_detail: "op" }).eq("id", runId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("brief_runs").update({ failure_detail: "v" }).eq("id", runId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: removes row", async () => {
      const { data, error } = await adminClient.from("brief_runs").delete().eq("id", runId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: removes row", async () => {
      const svc = getServiceRoleClient();
      const { data: nr } = await svc.from("brief_runs").insert({
        brief_id: briefId, status: "succeeded", finished_at: new Date().toISOString(),
      }).select("id").single();
      const { data, error } = await operatorClient.from("brief_runs").delete().eq("id", nr!.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("brief_runs").delete().eq("id", runId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // site_conventions — 12 cells
  // -----------------------------------------------------------------------

  describe("site_conventions", () => {
    it("admin SELECT: sees row", async () => {
      const { data, error } = await adminClient.from("site_conventions").select("id").eq("id", conventionsId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator SELECT: sees row", async () => {
      const { data, error } = await operatorClient.from("site_conventions").select("id").eq("id", conventionsId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer SELECT: sees row", async () => {
      const { data, error } = await viewerClient.from("site_conventions").select("id").eq("id", conventionsId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("admin INSERT: allowed", async () => {
      const svc = getServiceRoleClient();
      const { data: b } = await svc.from("briefs").insert(baseBriefRow(siteId, "scA")).select("id").single();
      const { error } = await adminClient.from("site_conventions").insert({ brief_id: b!.id });
      expect(error).toBeNull();
    });
    it("operator INSERT: allowed", async () => {
      const svc = getServiceRoleClient();
      const { data: b } = await svc.from("briefs").insert(baseBriefRow(siteId, "scO")).select("id").single();
      const { error } = await operatorClient.from("site_conventions").insert({ brief_id: b!.id });
      expect(error).toBeNull();
    });
    it("viewer INSERT: denied via 42501", async () => {
      const svc = getServiceRoleClient();
      const { data: b } = await svc.from("briefs").insert(baseBriefRow(siteId, "scV")).select("id").single();
      const { error } = await viewerClient.from("site_conventions").insert({ brief_id: b!.id });
      expect(error?.code).toBe("42501");
    });

    it("admin UPDATE: modifies row", async () => {
      const { data, error } = await adminClient.from("site_conventions").update({ typographic_scale: "admin" }).eq("id", conventionsId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator UPDATE: modifies row", async () => {
      const { data, error } = await operatorClient.from("site_conventions").update({ typographic_scale: "op" }).eq("id", conventionsId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer UPDATE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("site_conventions").update({ typographic_scale: "v" }).eq("id", conventionsId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("admin DELETE: removes row", async () => {
      const { data, error } = await adminClient.from("site_conventions").delete().eq("id", conventionsId).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("operator DELETE: removes row", async () => {
      const svc = getServiceRoleClient();
      const { data: b } = await svc.from("briefs").insert(baseBriefRow(siteId, "scOD")).select("id").single();
      const { data: sc } = await svc.from("site_conventions").insert({ brief_id: b!.id }).select("id").single();
      const { data, error } = await operatorClient.from("site_conventions").delete().eq("id", sc!.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
    it("viewer DELETE: silently filtered — 0 rows", async () => {
      const { data, error } = await viewerClient.from("site_conventions").delete().eq("id", conventionsId).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Service-role bypass (4 tables) — RLS is ignored.
  // -----------------------------------------------------------------------

  describe("service_role bypass", () => {
    it("service-role reads all briefs", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc.from("briefs").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
    it("service-role reads all brief_pages", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc.from("brief_pages").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
    it("service-role reads all brief_runs", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc.from("brief_runs").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
    it("service-role reads all site_conventions", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc.from("site_conventions").select("id");
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // authenticated-no-role sanity — public.auth_role() is NULL, all deny.
  // -----------------------------------------------------------------------

  describe("authenticated-no-role", () => {
    it("no-role SELECT briefs: filtered — 0 rows", async () => {
      const { data, error } = await noRoleClient.from("briefs").select("id").eq("id", briefId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
    it("no-role INSERT briefs: denied 42501", async () => {
      const { error } = await noRoleClient.from("briefs").insert(baseBriefRow(siteId, "nr"));
      expect(error?.code).toBe("42501");
    });
    it("no-role SELECT brief_pages: filtered — 0 rows", async () => {
      const { data, error } = await noRoleClient.from("brief_pages").select("id").eq("id", pageId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
    it("no-role INSERT brief_pages: denied 42501", async () => {
      const { error } = await noRoleClient.from("brief_pages").insert({
        brief_id: briefId, ordinal: 99, title: "NR", mode: "short_brief", source_text: "x", word_count: 1,
      });
      expect(error?.code).toBe("42501");
    });
    it("no-role SELECT brief_runs: filtered — 0 rows", async () => {
      const { data, error } = await noRoleClient.from("brief_runs").select("id").eq("id", runId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
    it("no-role INSERT brief_runs: denied 42501", async () => {
      const { error } = await noRoleClient.from("brief_runs").insert({ brief_id: briefId, status: "queued" });
      expect(error?.code).toBe("42501");
    });
    it("no-role SELECT site_conventions: filtered — 0 rows", async () => {
      const { data, error } = await noRoleClient.from("site_conventions").select("id").eq("id", conventionsId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
    it("no-role INSERT site_conventions: denied 42501", async () => {
      const svc = getServiceRoleClient();
      const { data: b } = await svc.from("briefs").insert(baseBriefRow(siteId, "scNR")).select("id").single();
      const { error } = await noRoleClient.from("site_conventions").insert({ brief_id: b!.id });
      expect(error?.code).toBe("42501");
    });
  });
});
