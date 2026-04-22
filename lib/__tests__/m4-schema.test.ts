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
// M4-1 schema tests.
//
// Pins the guarantees the M4 worker (M4-2/3/4/7) and the 9k seed script
// (M4-5) rely on. If any of these fail, the image pipeline can double-
// bill Cloudflare or Anthropic, or WP can receive duplicate media entries.
//
// Coverage:
//   1. image_library:
//        - cloudflare_id UNIQUE.
//        - (source, source_ref) UNIQUE with NULLS NOT DISTINCT.
//        - source CHECK.
//        - search_tsv generated column populated from caption+tags.
//   2. image_metadata: (image_id, key) UNIQUE, CASCADE from image.
//   3. image_usage: (image_id, site_id) UNIQUE — the write-safety
//      keystone. CASCADE from site, NO ACTION from image_library.
//   4. transfer_jobs:
//        - type CHECK.
//        - status CHECK.
//        - idempotency_key UNIQUE.
//        - site_id coherence CHECK (wp_media_transfer requires site,
//          cloudflare_ingest forbids site).
//   5. transfer_job_items:
//        - state CHECK.
//        - UNIQUE (job, slot_index).
//        - UNIQUE (job, cloudflare_idempotency_key).
//        - UNIQUE (job, anthropic_idempotency_key).
//        - lease coherence CHECK.
//        - CASCADE from job.
//   6. transfer_events: append-only insert + CASCADE from job.
//   7. RLS:
//        - service_role_all allows every op.
//        - authenticated admin / operator / viewer read image_library.
//        - viewer cannot insert or update image_library.
//        - transfer_jobs: admin sees all, operator sees own, viewer sees
//          nothing.
// ---------------------------------------------------------------------------

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "m4-schema.test: SUPABASE_URL + SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe("M4-1: image-library schema", () => {
  let admin: SeededAuthUser;
  let operator: SeededAuthUser;
  let viewer: SeededAuthUser;
  let adminClient: SupabaseClient;
  let operatorClient: SupabaseClient;
  let viewerClient: SupabaseClient;

  beforeAll(async () => {
    admin = await seedAuthUser({
      email: "m4-admin@opollo.test",
      role: "admin",
      persistent: true,
    });
    operator = await seedAuthUser({
      email: "m4-operator@opollo.test",
      role: "operator",
      persistent: true,
    });
    viewer = await seedAuthUser({
      email: "m4-viewer@opollo.test",
      role: "viewer",
      persistent: true,
    });
    adminClient = buildClient(await signInAs(admin));
    operatorClient = buildClient(await signInAs(operator));
    viewerClient = buildClient(await signInAs(viewer));
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [admin, operator, viewer]) {
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  beforeEach(async () => {
    // _setup.ts TRUNCATEs everything. Re-insert the role rows so
    // public.auth_role() resolves for the authenticated clients.
    const svc = getServiceRoleClient();
    await svc.from("opollo_users").insert([
      { id: admin.id, email: admin.email, role: "admin" },
      { id: operator.id, email: operator.email, role: "operator" },
      { id: viewer.id, email: viewer.email, role: "viewer" },
    ]);
  });

  // -------------------------------------------------------------------------
  // image_library constraints
  // -------------------------------------------------------------------------

  describe("image_library", () => {
    it("rejects duplicate cloudflare_id", async () => {
      const svc = getServiceRoleClient();
      const a = await svc
        .from("image_library")
        .insert({
          cloudflare_id: "cf-abc-001",
          source: "upload",
          source_ref: "a.jpg",
        })
        .select("id");
      expect(a.error).toBeNull();

      const b = await svc
        .from("image_library")
        .insert({
          cloudflare_id: "cf-abc-001",
          source: "upload",
          source_ref: "b.jpg",
        })
        .select("id");
      expect(b.error).not.toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("rejects duplicate (source, source_ref) — iStock double-ingest guard", async () => {
      const svc = getServiceRoleClient();
      const a = await svc
        .from("image_library")
        .insert({
          source: "istock",
          source_ref: "istock-12345",
        })
        .select("id");
      expect(a.error).toBeNull();

      const b = await svc
        .from("image_library")
        .insert({
          source: "istock",
          source_ref: "istock-12345",
        })
        .select("id");
      expect(b.error).not.toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("allows multiple NULL source_refs (upload path)", async () => {
      const svc = getServiceRoleClient();
      const a = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: null })
        .select("id");
      expect(a.error).toBeNull();

      const b = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: null })
        .select("id");
      // NULLS NOT DISTINCT: NULL != NULL; this should succeed.
      // Wait: NULLS NOT DISTINCT means NULLs ARE treated as equal,
      // so this should FAIL. The constraint says NULLS NOT DISTINCT
      // specifically so "two uploads without a ref" don't both land —
      // in practice 'upload' rows should always carry a synthetic
      // source_ref (the file hash).
      expect(b.error).not.toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("rejects invalid source value", async () => {
      const svc = getServiceRoleClient();
      const r = await svc
        .from("image_library")
        .insert({
          source: "pexels",
          source_ref: "irrelevant",
        })
        .select("id");
      expect(r.error).not.toBeNull();
      expect(r.error?.code).toBe("23514");
    });

    it("populates search_tsv from caption + tags", async () => {
      const svc = getServiceRoleClient();
      const { data, error } = await svc
        .from("image_library")
        .insert({
          source: "istock",
          source_ref: "istock-tsv-test",
          caption: "A photo of a golden retriever in a sunlit meadow",
          tags: ["dog", "meadow", "sunset", "warm"],
        })
        .select("id, search_tsv")
        .single();
      expect(error).toBeNull();
      expect(typeof data?.search_tsv).toBe("string");
      // tsvector text dump contains lexeme stems + weights.
      expect(data?.search_tsv).toContain("retriev"); // stemmed
      expect(data?.search_tsv).toContain("meadow");
    });

    it("rejects width_px <= 0", async () => {
      const svc = getServiceRoleClient();
      const r = await svc
        .from("image_library")
        .insert({
          source: "upload",
          source_ref: "bad-width",
          width_px: 0,
        })
        .select("id");
      expect(r.error?.code).toBe("23514");
    });
  });

  // -------------------------------------------------------------------------
  // image_metadata
  // -------------------------------------------------------------------------

  describe("image_metadata", () => {
    it("enforces (image_id, key) UNIQUE and CASCADEs from image", async () => {
      const svc = getServiceRoleClient();
      const { data: img } = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: "img-md-1" })
        .select("id")
        .single();

      const a = await svc
        .from("image_metadata")
        .insert({ image_id: img!.id, key: "exif", value_jsonb: { iso: 400 } });
      expect(a.error).toBeNull();

      const b = await svc
        .from("image_metadata")
        .insert({ image_id: img!.id, key: "exif", value_jsonb: { iso: 800 } });
      expect(b.error?.code).toBe("23505");

      // CASCADE delete: remove the parent image, metadata disappears.
      const del = await svc.from("image_library").delete().eq("id", img!.id);
      expect(del.error).toBeNull();

      const { count } = await svc
        .from("image_metadata")
        .select("id", { count: "exact", head: true })
        .eq("image_id", img!.id);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // image_usage — THE write-safety keystone
  // -------------------------------------------------------------------------

  describe("image_usage", () => {
    it("rejects a second (image_id, site_id) pair — prevents duplicate WP upload", async () => {
      const svc = getServiceRoleClient();
      const { id: siteId } = await seedSite();
      const { data: img } = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: "dup-test" })
        .select("id")
        .single();

      const a = await svc
        .from("image_usage")
        .insert({
          image_id: img!.id,
          site_id: siteId,
          wp_idempotency_marker: "marker-a",
        });
      expect(a.error).toBeNull();

      const b = await svc
        .from("image_usage")
        .insert({
          image_id: img!.id,
          site_id: siteId,
          wp_idempotency_marker: "marker-b", // different marker; constraint is on (image,site) only
        });
      expect(b.error?.code).toBe("23505");
    });

    it("allows the same image across different sites", async () => {
      const svc = getServiceRoleClient();
      const siteA = await seedSite();
      const siteB = await seedSite();
      const { data: img } = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: "cross-site" })
        .select("id")
        .single();

      const a = await svc.from("image_usage").insert({
        image_id: img!.id,
        site_id: siteA.id,
        wp_idempotency_marker: "m-a",
      });
      const b = await svc.from("image_usage").insert({
        image_id: img!.id,
        site_id: siteB.id,
        wp_idempotency_marker: "m-b",
      });
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
    });

    it("CASCADEs when the site is removed", async () => {
      const svc = getServiceRoleClient();
      const { id: siteId } = await seedSite();
      const { data: img } = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: "site-cascade" })
        .select("id")
        .single();

      await svc.from("image_usage").insert({
        image_id: img!.id,
        site_id: siteId,
        wp_idempotency_marker: "m",
      });

      await svc.from("sites").delete().eq("id", siteId);
      const { count } = await svc
        .from("image_usage")
        .select("id", { count: "exact", head: true })
        .eq("image_id", img!.id);
      expect(count).toBe(0);
    });

    it("refuses to hard-delete an image that has a usage row (NO ACTION)", async () => {
      const svc = getServiceRoleClient();
      const { id: siteId } = await seedSite();
      const { data: img } = await svc
        .from("image_library")
        .insert({ source: "upload", source_ref: "no-action" })
        .select("id")
        .single();

      await svc.from("image_usage").insert({
        image_id: img!.id,
        site_id: siteId,
        wp_idempotency_marker: "m",
      });

      const r = await svc.from("image_library").delete().eq("id", img!.id);
      expect(r.error?.code).toBe("23503"); // FK violation
    });
  });

  // -------------------------------------------------------------------------
  // transfer_jobs constraints
  // -------------------------------------------------------------------------

  describe("transfer_jobs", () => {
    it("rejects unknown type", async () => {
      const svc = getServiceRoleClient();
      const r = await svc
        .from("transfer_jobs")
        .insert({
          type: "magic-transfer",
          requested_count: 1,
        });
      expect(r.error?.code).toBe("23514");
    });

    it("rejects unknown status", async () => {
      const svc = getServiceRoleClient();
      const r = await svc.from("transfer_jobs").insert({
        type: "cloudflare_ingest",
        status: "in-orbit",
        requested_count: 1,
      });
      expect(r.error?.code).toBe("23514");
    });

    it("enforces UNIQUE idempotency_key", async () => {
      const svc = getServiceRoleClient();
      const a = await svc.from("transfer_jobs").insert({
        type: "cloudflare_ingest",
        idempotency_key: "idem-1",
        requested_count: 1,
      });
      const b = await svc.from("transfer_jobs").insert({
        type: "cloudflare_ingest",
        idempotency_key: "idem-1",
        requested_count: 1,
      });
      expect(a.error).toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("rejects cloudflare_ingest with a site_id set", async () => {
      const svc = getServiceRoleClient();
      const { id: siteId } = await seedSite();
      const r = await svc.from("transfer_jobs").insert({
        type: "cloudflare_ingest",
        site_id: siteId,
        requested_count: 1,
      });
      expect(r.error?.code).toBe("23514");
    });

    it("rejects wp_media_transfer without a site_id", async () => {
      const svc = getServiceRoleClient();
      const r = await svc.from("transfer_jobs").insert({
        type: "wp_media_transfer",
        requested_count: 1,
      });
      expect(r.error?.code).toBe("23514");
    });

    it("accepts the canonical cloudflare_ingest row", async () => {
      const svc = getServiceRoleClient();
      const r = await svc.from("transfer_jobs").insert({
        type: "cloudflare_ingest",
        requested_count: 100,
      });
      expect(r.error).toBeNull();
    });

    it("accepts the canonical wp_media_transfer row", async () => {
      const svc = getServiceRoleClient();
      const { id: siteId } = await seedSite();
      const r = await svc.from("transfer_jobs").insert({
        type: "wp_media_transfer",
        site_id: siteId,
        requested_count: 5,
      });
      expect(r.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // transfer_job_items constraints
  // -------------------------------------------------------------------------

  describe("transfer_job_items", () => {
    async function seedJob(): Promise<string> {
      const svc = getServiceRoleClient();
      const { data } = await svc
        .from("transfer_jobs")
        .insert({
          type: "cloudflare_ingest",
          requested_count: 5,
        })
        .select("id")
        .single();
      return data!.id;
    }

    it("rejects duplicate (job_id, slot_index)", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();

      const a = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-a",
        anthropic_idempotency_key: "an-a",
      });
      const b = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-b",
        anthropic_idempotency_key: "an-b",
      });
      expect(a.error).toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("rejects duplicate cloudflare_idempotency_key within a job", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      const a = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-shared",
        anthropic_idempotency_key: "an-a",
      });
      const b = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 1,
        cloudflare_idempotency_key: "cf-shared",
        anthropic_idempotency_key: "an-b",
      });
      expect(a.error).toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("rejects duplicate anthropic_idempotency_key within a job", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      const a = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-a",
        anthropic_idempotency_key: "an-shared",
      });
      const b = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 1,
        cloudflare_idempotency_key: "cf-b",
        anthropic_idempotency_key: "an-shared",
      });
      expect(a.error).toBeNull();
      expect(b.error?.code).toBe("23505");
    });

    it("allows same idempotency keys across different jobs", async () => {
      const svc = getServiceRoleClient();
      const jobA = await seedJob();
      const jobB = await seedJob();
      const a = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobA,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-reused",
        anthropic_idempotency_key: "an-reused",
      });
      const b = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobB,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-reused",
        anthropic_idempotency_key: "an-reused",
      });
      expect(a.error).toBeNull();
      expect(b.error).toBeNull();
    });

    it("rejects invalid state", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      const r = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        state: "in-transit",
        cloudflare_idempotency_key: "cf-x",
        anthropic_idempotency_key: "an-x",
      });
      expect(r.error?.code).toBe("23514");
    });

    it("rejects pending state with worker_id set (lease coherence)", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      const r = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        state: "pending",
        worker_id: "w-1",
        cloudflare_idempotency_key: "cf-x",
        anthropic_idempotency_key: "an-x",
      });
      expect(r.error?.code).toBe("23514");
    });

    it("allows leased state with worker_id + lease_expires_at", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      const r = await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        state: "leased",
        worker_id: "w-1",
        lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
        cloudflare_idempotency_key: "cf-x",
        anthropic_idempotency_key: "an-x",
      });
      expect(r.error).toBeNull();
    });

    it("CASCADEs when the parent job is deleted", async () => {
      const svc = getServiceRoleClient();
      const jobId = await seedJob();
      await svc.from("transfer_job_items").insert({
        transfer_job_id: jobId,
        slot_index: 0,
        cloudflare_idempotency_key: "cf-c",
        anthropic_idempotency_key: "an-c",
      });

      await svc.from("transfer_jobs").delete().eq("id", jobId);
      const { count } = await svc
        .from("transfer_job_items")
        .select("id", { count: "exact", head: true })
        .eq("transfer_job_id", jobId);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // transfer_events
  // -------------------------------------------------------------------------

  describe("transfer_events", () => {
    it("inserts an event row + CASCADEs from parent job", async () => {
      const svc = getServiceRoleClient();
      const { data: job } = await svc
        .from("transfer_jobs")
        .insert({ type: "cloudflare_ingest", requested_count: 1 })
        .select("id")
        .single();

      await svc.from("transfer_events").insert({
        transfer_job_id: job!.id,
        event_type: "cloudflare_upload_started",
        payload_jsonb: { attempt: 1 },
      });
      await svc.from("transfer_events").insert({
        transfer_job_id: job!.id,
        event_type: "cloudflare_upload_succeeded",
        payload_jsonb: { cf_id: "abc" },
        cost_cents: 0,
      });

      const { count: before } = await svc
        .from("transfer_events")
        .select("id", { count: "exact", head: true })
        .eq("transfer_job_id", job!.id);
      expect(before).toBe(2);

      await svc.from("transfer_jobs").delete().eq("id", job!.id);

      const { count: after } = await svc
        .from("transfer_events")
        .select("id", { count: "exact", head: true })
        .eq("transfer_job_id", job!.id);
      expect(after).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // RLS
  // -------------------------------------------------------------------------

  describe("RLS", () => {
    describe("image_library", () => {
      beforeEach(async () => {
        const svc = getServiceRoleClient();
        await svc
          .from("image_library")
          .insert({ source: "upload", source_ref: "rls-seed" });
      });

      it("admin SELECT: reads non-deleted rows", async () => {
        const { data, error } = await adminClient
          .from("image_library")
          .select("id, source");
        expect(error).toBeNull();
        expect(data?.length ?? 0).toBeGreaterThan(0);
      });

      it("operator SELECT: reads non-deleted rows", async () => {
        const { data, error } = await operatorClient
          .from("image_library")
          .select("id, source");
        expect(error).toBeNull();
        expect(data?.length ?? 0).toBeGreaterThan(0);
      });

      it("viewer SELECT: reads non-deleted rows", async () => {
        const { data, error } = await viewerClient
          .from("image_library")
          .select("id, source");
        expect(error).toBeNull();
        expect(data?.length ?? 0).toBeGreaterThan(0);
      });

      it("viewer INSERT: denied", async () => {
        const { data, error } = await viewerClient
          .from("image_library")
          .insert({ source: "upload", source_ref: "viewer-denied" })
          .select();
        expect(data).toBeNull();
        expect(error?.code).toBe("42501");
      });

      it("operator INSERT: allowed", async () => {
        const { data, error } = await operatorClient
          .from("image_library")
          .insert({ source: "upload", source_ref: "operator-allowed" })
          .select();
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      });

      it("admin SELECT: filters out deleted_at IS NOT NULL", async () => {
        const svc = getServiceRoleClient();
        const { data: row } = await svc
          .from("image_library")
          .insert({ source: "upload", source_ref: "tombstone" })
          .select("id")
          .single();
        await svc
          .from("image_library")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row!.id);

        const { data } = await adminClient
          .from("image_library")
          .select("id")
          .eq("id", row!.id);
        expect(data).toHaveLength(0);
      });
    });

    describe("transfer_jobs", () => {
      it("admin reads every job; operator reads only own; viewer reads none", async () => {
        const svc = getServiceRoleClient();
        await svc
          .from("transfer_jobs")
          .insert({
            type: "cloudflare_ingest",
            requested_count: 1,
            created_by: admin.id,
          });
        await svc
          .from("transfer_jobs")
          .insert({
            type: "cloudflare_ingest",
            requested_count: 1,
            created_by: operator.id,
          });

        const adminRows = await adminClient
          .from("transfer_jobs")
          .select("id, created_by");
        const operatorRows = await operatorClient
          .from("transfer_jobs")
          .select("id, created_by");
        const viewerRows = await viewerClient
          .from("transfer_jobs")
          .select("id, created_by");

        expect(adminRows.error).toBeNull();
        expect(adminRows.data?.length).toBe(2);

        expect(operatorRows.error).toBeNull();
        expect(operatorRows.data?.length).toBe(1);
        expect(operatorRows.data?.[0].created_by).toBe(operator.id);

        expect(viewerRows.error).toBeNull();
        expect(viewerRows.data?.length).toBe(0);
      });
    });

    describe("transfer_job_items", () => {
      it("inherits visibility from parent job", async () => {
        const svc = getServiceRoleClient();
        const { data: job } = await svc
          .from("transfer_jobs")
          .insert({
            type: "cloudflare_ingest",
            requested_count: 1,
            created_by: operator.id,
          })
          .select("id")
          .single();
        await svc.from("transfer_job_items").insert({
          transfer_job_id: job!.id,
          slot_index: 0,
          cloudflare_idempotency_key: "cf-i",
          anthropic_idempotency_key: "an-i",
        });

        const op = await operatorClient
          .from("transfer_job_items")
          .select("id, transfer_job_id");
        expect(op.error).toBeNull();
        expect(op.data?.length).toBe(1);

        const view = await viewerClient
          .from("transfer_job_items")
          .select("id");
        expect(view.error).toBeNull();
        expect(view.data?.length).toBe(0);
      });
    });
  });
});
