import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createComponent } from "@/lib/components";
import { createDesignSystem } from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";

import {
  seedAuthUser,
  signInAs,
  type SeededAuthUser,
} from "./_auth-helpers";
import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-1 schema tests.
//
// Pins the guarantees the M3 worker + creator endpoint (M3-2, M3-3) rely
// on. If any of these fail, downstream concurrency claims break and the
// batch generator can lose money (double Anthropic billing) or duplicate
// WordPress pages.
//
// Coverage:
//   1. pages has UNIQUE (site_id, slug) — the durable slug-race guard.
//   2. generation_jobs: CHECK on status, UNIQUE idempotency_key, created_by
//      FK SET NULL on user delete, CASCADE delete sweeps job_pages + events.
//   3. generation_job_pages: UNIQUE (job_id, slot_index), UNIQUE on both
//      idempotency keys (anthropic + wp) per job, state CHECK, lease-
//      coherence CHECK, partial lease index usable (smoke).
//   4. generation_events: append-only insert, CASCADE from job delete.
//   5. RLS:
//       - service_role_all allows every op.
//       - authenticated admin SELECTs every job, slot, event.
//       - operator who created a job SELECTs their own rows; operator
//         who did NOT create it sees nothing.
//       - viewer sees nothing (no role has implicit read on these).
// ---------------------------------------------------------------------------

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "m3-schema.test: SUPABASE_URL + SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function seedTemplate(siteId: string): Promise<string> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(`seed ds failed: ${ds.error.message}`);

  for (const name of ["hero-centered", "footer-default"]) {
    const r = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0] ?? "misc",
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!r.ok) throw new Error(`seed component failed: ${r.error.message}`);
  }

  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(`seed template failed: ${t.error.message}`);
  return t.data.id;
}

async function seedJob(
  siteId: string,
  templateId: string,
  createdBy?: string | null,
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("generation_jobs")
    .insert({
      site_id: siteId,
      template_id: templateId,
      status: "queued",
      requested_count: 3,
      created_by: createdBy ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedJob failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

async function seedSlot(
  jobId: string,
  slotIndex: number,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("generation_job_pages")
    .insert({
      job_id: jobId,
      slot_index: slotIndex,
      inputs: { slug: `seed-${slotIndex}` },
      anthropic_idempotency_key: `anthropic-${jobId}-${slotIndex}`,
      wp_idempotency_key: `wp-${jobId}-${slotIndex}`,
      ...extra,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedSlot failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

// ===========================================================================
// pages.UNIQUE (site_id, slug)
// ===========================================================================

describe("M3-1 — pages UNIQUE (site_id, slug)", () => {
  it("rejects a second page with the same (site_id, slug)", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();

    const base = {
      site_id: site.id,
      wp_page_id: 1,
      slug: "duplicate-slug",
      title: "t",
      page_type: "homepage",
      design_system_version: 1,
    };
    const first = await svc.from("pages").insert(base).select("id").single();
    expect(first.error).toBeNull();

    const dupe = await svc
      .from("pages")
      .insert({ ...base, wp_page_id: 2 })
      .select("id")
      .single();
    expect(dupe.error).not.toBeNull();
    // PostgREST surfaces unique_violation as 23505.
    expect(dupe.error?.code).toBe("23505");
  });

  it("allows the same slug on a different site", async () => {
    const siteA = await seedSite({ prefix: "aa" });
    const siteB = await seedSite({ prefix: "bb" });
    const svc = getServiceRoleClient();

    for (const site of [siteA, siteB]) {
      const { error } = await svc.from("pages").insert({
        site_id: site.id,
        wp_page_id: 99,
        slug: "shared-slug",
        title: "t",
        page_type: "homepage",
        design_system_version: 1,
      });
      expect(error).toBeNull();
    }
  });
});

// ===========================================================================
// generation_jobs
// ===========================================================================

describe("M3-1 — generation_jobs constraints", () => {
  it("accepts valid status values and rejects invalid ones", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const svc = getServiceRoleClient();

    const { error: bad } = await svc.from("generation_jobs").insert({
      site_id: site.id,
      template_id: templateId,
      status: "totally-invalid",
      requested_count: 1,
    });
    expect(bad).not.toBeNull();
    // CHECK violation is 23514.
    expect(bad?.code).toBe("23514");
  });

  it("enforces UNIQUE idempotency_key", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const svc = getServiceRoleClient();

    const key = `idem-${Date.now()}`;
    const first = await svc
      .from("generation_jobs")
      .insert({
        site_id: site.id,
        template_id: templateId,
        status: "queued",
        requested_count: 1,
        idempotency_key: key,
      })
      .select("id")
      .single();
    expect(first.error).toBeNull();

    const dupe = await svc.from("generation_jobs").insert({
      site_id: site.id,
      template_id: templateId,
      status: "queued",
      requested_count: 1,
      idempotency_key: key,
    });
    expect(dupe.error?.code).toBe("23505");
  });

  it("rejects requested_count <= 0", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const svc = getServiceRoleClient();

    const { error } = await svc.from("generation_jobs").insert({
      site_id: site.id,
      template_id: templateId,
      status: "queued",
      requested_count: 0,
    });
    expect(error?.code).toBe("23514");
  });
});

// ===========================================================================
// generation_job_pages
// ===========================================================================

describe("M3-1 — generation_job_pages constraints", () => {
  it("UNIQUE (job_id, slot_index) rejects duplicate slot index", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);

    await seedSlot(jobId, 0);
    await expect(seedSlot(jobId, 0)).rejects.toThrow(/23505|duplicate/i);
  });

  it("UNIQUE (job_id, anthropic_idempotency_key) rejects duplicate anthropic key within a job", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);
    const svc = getServiceRoleClient();

    await seedSlot(jobId, 0);
    const dupe = await svc.from("generation_job_pages").insert({
      job_id: jobId,
      slot_index: 1,
      inputs: { slug: "a" },
      anthropic_idempotency_key: `anthropic-${jobId}-0`, // collides with slot 0
      wp_idempotency_key: `wp-${jobId}-1`,
    });
    expect(dupe.error?.code).toBe("23505");
  });

  it("state CHECK rejects unknown transitions", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);
    const svc = getServiceRoleClient();

    const { error } = await svc.from("generation_job_pages").insert({
      job_id: jobId,
      slot_index: 0,
      state: "mutated",
      inputs: {},
      anthropic_idempotency_key: "a",
      wp_idempotency_key: "w",
    });
    expect(error?.code).toBe("23514");
  });

  it("lease-coherence CHECK rejects state='pending' with worker_id set", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);
    const svc = getServiceRoleClient();

    const { error } = await svc.from("generation_job_pages").insert({
      job_id: jobId,
      slot_index: 0,
      state: "pending",
      inputs: {},
      anthropic_idempotency_key: "a",
      wp_idempotency_key: "w",
      worker_id: "rogue-worker",
    });
    expect(error?.code).toBe("23514");
  });

  it("allows state='leased' with worker_id + lease_expires_at populated", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);

    const slotId = await seedSlot(jobId, 0, {
      state: "leased",
      worker_id: "worker-1",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(slotId).toBeTruthy();
  });

  it("cascades delete from generation_jobs", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);
    const slotId = await seedSlot(jobId, 0);
    const svc = getServiceRoleClient();

    const { error } = await svc
      .from("generation_jobs")
      .delete()
      .eq("id", jobId);
    expect(error).toBeNull();

    const { data } = await svc
      .from("generation_job_pages")
      .select("id")
      .eq("id", slotId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

// ===========================================================================
// generation_events
// ===========================================================================

describe("M3-1 — generation_events", () => {
  it("append-only insert + CASCADE from job delete", async () => {
    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId);
    const slotId = await seedSlot(jobId, 0);
    const svc = getServiceRoleClient();

    const { error: insertErr } = await svc.from("generation_events").insert({
      job_id: jobId,
      page_slot_id: slotId,
      event: "anthropic_response_received",
      details: { input_tokens: 100, output_tokens: 200 },
    });
    expect(insertErr).toBeNull();

    const { data: before } = await svc
      .from("generation_events")
      .select("id")
      .eq("job_id", jobId);
    expect(before?.length).toBe(1);

    await svc.from("generation_jobs").delete().eq("id", jobId);

    const { data: after } = await svc
      .from("generation_events")
      .select("id")
      .eq("job_id", jobId);
    expect(after?.length ?? 0).toBe(0);
  });
});

// ===========================================================================
// RLS
// ===========================================================================

describe("M3-1 — RLS policies", () => {
  let creator: SeededAuthUser;
  let otherOperator: SeededAuthUser;
  let admin: SeededAuthUser;
  let viewer: SeededAuthUser;

  let creatorClient: SupabaseClient;
  let otherOperatorClient: SupabaseClient;
  let adminClient: SupabaseClient;
  let viewerClient: SupabaseClient;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "m3-creator@opollo.test",
      role: "operator",
      persistent: true,
    });
    otherOperator = await seedAuthUser({
      email: "m3-other@opollo.test",
      role: "operator",
      persistent: true,
    });
    admin = await seedAuthUser({
      email: "m3-admin@opollo.test",
      role: "admin",
      persistent: true,
    });
    viewer = await seedAuthUser({
      email: "m3-viewer@opollo.test",
      role: "viewer",
      persistent: true,
    });

    creatorClient = buildClient(await signInAs(creator));
    otherOperatorClient = buildClient(await signInAs(otherOperator));
    adminClient = buildClient(await signInAs(admin));
    viewerClient = buildClient(await signInAs(viewer));
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [creator, otherOperator, admin, viewer]) {
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  it("creator sees own job, other operator doesn't, admin does, viewer doesn't", async () => {
    // Seed auth users a second time — _setup.ts TRUNCATE wiped opollo_users
    // but not auth.users. Re-insert so FK from generation_jobs.created_by
    // resolves.
    const svc = getServiceRoleClient();
    for (const u of [creator, otherOperator, admin, viewer]) {
      await svc
        .from("opollo_users")
        .upsert(
          { id: u.id, email: u.email, role: u.role },
          { onConflict: "id" },
        );
    }

    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId, creator.id);

    const readAs = async (c: SupabaseClient): Promise<string[]> => {
      const { data } = await c
        .from("generation_jobs")
        .select("id")
        .eq("id", jobId);
      return (data ?? []).map((r) => r.id as string);
    };

    expect(await readAs(creatorClient)).toContain(jobId);
    expect(await readAs(adminClient)).toContain(jobId);
    expect(await readAs(otherOperatorClient)).toEqual([]);
    expect(await readAs(viewerClient)).toEqual([]);
  });

  it("job_pages and events inherit job visibility", async () => {
    const svc = getServiceRoleClient();
    for (const u of [creator, otherOperator, admin]) {
      await svc
        .from("opollo_users")
        .upsert(
          { id: u.id, email: u.email, role: u.role },
          { onConflict: "id" },
        );
    }

    const site = await seedSite();
    const templateId = await seedTemplate(site.id);
    const jobId = await seedJob(site.id, templateId, creator.id);
    const slotId = await seedSlot(jobId, 0);
    await svc.from("generation_events").insert({
      job_id: jobId,
      page_slot_id: slotId,
      event: "queued",
    });

    const readSlots = async (c: SupabaseClient) =>
      (await c.from("generation_job_pages").select("id").eq("id", slotId))
        .data ?? [];
    const readEvents = async (c: SupabaseClient) =>
      (await c.from("generation_events").select("id").eq("job_id", jobId))
        .data ?? [];

    expect((await readSlots(creatorClient)).length).toBe(1);
    expect((await readSlots(adminClient)).length).toBe(1);
    expect((await readSlots(otherOperatorClient)).length).toBe(0);

    expect((await readEvents(creatorClient)).length).toBe(1);
    expect((await readEvents(adminClient)).length).toBe(1);
    expect((await readEvents(otherOperatorClient)).length).toBe(0);
  });
});
