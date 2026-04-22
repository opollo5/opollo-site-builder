import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import {
  seedAuthUser,
  type SeededAuthUser,
} from "./_auth-helpers";
import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-1 schema tests — briefs / brief_pages / brief_runs / site_conventions.
//
// Pins the constraints the upload + parser + commit paths rely on:
//
//   - UNIQUE (source_storage_path) — one brief per Storage object.
//   - UNIQUE (upload_idempotency_key) — double-submit replays.
//   - UNIQUE (brief_id, ordinal) on brief_pages — no duplicate positions.
//   - UNIQUE (brief_id) on site_conventions — one row per brief.
//   - brief_runs partial UNIQUE (one active run per brief).
//   - coherence CHECK: committed iff (committed_at AND committed_page_hash).
//   - lease-coherence CHECK on brief_runs.
//   - FK CASCADE on brief_id deletes.
//   - FK SET NULL for opollo_users references.
// ---------------------------------------------------------------------------

function makeIdempKey(suffix: string): string {
  return `m12-1-schema-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeStoragePath(suffix: string): string {
  return `m12-1-schema/${suffix}/${Math.random().toString(36).slice(2, 10)}.md`;
}

async function insertBrief(opts: {
  site_id: string;
  status?: string;
  storage_path?: string;
  idempotency_key?: string;
  committed_at?: string | null;
  committed_page_hash?: string | null;
  created_by?: string | null;
  title?: string;
}): Promise<{ id: string }> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("briefs")
    .insert({
      site_id: opts.site_id,
      title: opts.title ?? "Test Brief",
      status: opts.status ?? "parsed",
      source_storage_path: opts.storage_path ?? makeStoragePath("b"),
      source_mime_type: "text/markdown",
      source_size_bytes: 1024,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: opts.idempotency_key ?? makeIdempKey("b"),
      committed_at: opts.committed_at ?? null,
      committed_page_hash: opts.committed_page_hash ?? null,
      created_by: opts.created_by ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertBrief failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id as string };
}

describe("M12-1: briefs / brief_pages / brief_runs / site_conventions", () => {
  let opUser: SeededAuthUser;

  beforeAll(async () => {
    opUser = await seedAuthUser({
      email: "m12-1-schema-op@opollo.test",
      role: "operator",
      persistent: true,
    });
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    await svc.auth.admin.deleteUser(opUser.id);
  });

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------

  it("1. happy-path: inserts one brief + three pages + one run + conventions", async () => {
    const svc = getServiceRoleClient();
    const { id: siteId } = await seedSite({ prefix: "m121" });

    const { id: briefId } = await insertBrief({
      site_id: siteId,
      status: "parsed",
    });

    const pagesRes = await svc.from("brief_pages").insert([
      { brief_id: briefId, ordinal: 0, title: "Home",  mode: "full_text",   source_text: "Home copy", word_count: 500 },
      { brief_id: briefId, ordinal: 1, title: "About", mode: "short_brief", source_text: "About outline", word_count: 30 },
      { brief_id: briefId, ordinal: 2, title: "Pricing", mode: "short_brief", source_text: "Pricing outline", word_count: 40 },
    ]);
    expect(pagesRes.error).toBeNull();

    const runRes = await svc
      .from("brief_runs")
      .insert({ brief_id: briefId, status: "queued" })
      .select("id")
      .single();
    expect(runRes.error).toBeNull();

    const convRes = await svc
      .from("site_conventions")
      .insert({ brief_id: briefId, typographic_scale: "generous" })
      .select("id")
      .single();
    expect(convRes.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. UNIQUE constraints
  // -------------------------------------------------------------------------

  it("2. rejects duplicate source_storage_path (23505)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12b" });
    const path = makeStoragePath("dup");
    await insertBrief({ site_id: siteId, storage_path: path });

    const svc = getServiceRoleClient();
    const res = await svc.from("briefs").insert({
      site_id: siteId,
      title: "Second",
      source_storage_path: path,
      source_mime_type: "text/markdown",
      source_size_bytes: 1024,
      source_sha256: "1".repeat(64),
      upload_idempotency_key: makeIdempKey("dup-other"),
    });
    expect(res.error?.code).toBe("23505");
  });

  it("3. rejects duplicate upload_idempotency_key (23505)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12c" });
    const key = makeIdempKey("dup-key");
    await insertBrief({ site_id: siteId, idempotency_key: key });

    const svc = getServiceRoleClient();
    const res = await svc.from("briefs").insert({
      site_id: siteId,
      title: "Second",
      source_storage_path: makeStoragePath("k2"),
      source_mime_type: "text/markdown",
      source_size_bytes: 1024,
      source_sha256: "1".repeat(64),
      upload_idempotency_key: key,
    });
    expect(res.error?.code).toBe("23505");
  });

  it("4. rejects duplicate (brief_id, ordinal) on brief_pages (23505)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12d" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();

    const first = await svc.from("brief_pages").insert({
      brief_id: briefId, ordinal: 0, title: "A", mode: "full_text",
      source_text: "x", word_count: 1,
    });
    expect(first.error).toBeNull();

    const second = await svc.from("brief_pages").insert({
      brief_id: briefId, ordinal: 0, title: "B", mode: "full_text",
      source_text: "y", word_count: 1,
    });
    expect(second.error?.code).toBe("23505");
  });

  it("5. rejects duplicate site_conventions row per brief (23505)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12e" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();

    const first = await svc.from("site_conventions").insert({ brief_id: briefId });
    expect(first.error).toBeNull();

    const second = await svc.from("site_conventions").insert({ brief_id: briefId });
    expect(second.error?.code).toBe("23505");
  });

  // -------------------------------------------------------------------------
  // 6. Partial unique index on brief_runs (one active run per brief)
  // -------------------------------------------------------------------------

  it("6. partial UNIQUE brief_runs_one_active_per_brief: rejects second active run; allows after terminal", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12f" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();

    const a = await svc.from("brief_runs").insert({ brief_id: briefId, status: "queued" }).select("id").single();
    expect(a.error).toBeNull();
    const firstRunId = a.data!.id as string;

    const b = await svc.from("brief_runs").insert({ brief_id: briefId, status: "queued" });
    expect(b.error?.code).toBe("23505");

    // Flip first to terminal; a second active insert should now succeed.
    const update = await svc.from("brief_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString() })
      .eq("id", firstRunId);
    expect(update.error).toBeNull();

    const c = await svc.from("brief_runs").insert({ brief_id: briefId, status: "queued" });
    expect(c.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7-8. briefs coherence CHECKs
  // -------------------------------------------------------------------------

  it("7. coherence CHECK: status='committed' requires committed_at (23514)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12g" });
    const svc = getServiceRoleClient();
    const res = await svc.from("briefs").insert({
      site_id: siteId,
      title: "Bad",
      status: "committed",
      source_storage_path: makeStoragePath("bad1"),
      source_mime_type: "text/markdown",
      source_size_bytes: 10,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: makeIdempKey("bad1"),
      committed_at: null,
      committed_page_hash: null,
    });
    expect(res.error?.code).toBe("23514");
  });

  it("8. coherence CHECK: status='parsing' with committed_at set (23514)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12h" });
    const svc = getServiceRoleClient();
    const res = await svc.from("briefs").insert({
      site_id: siteId,
      title: "Bad",
      status: "parsing",
      source_storage_path: makeStoragePath("bad2"),
      source_mime_type: "text/markdown",
      source_size_bytes: 10,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: makeIdempKey("bad2"),
      committed_at: new Date().toISOString(),
      committed_page_hash: "deadbeef",
    });
    expect(res.error?.code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // 9. size/mime/mode CHECKs
  // -------------------------------------------------------------------------

  it("9. rejects source_size_bytes = 0 and > 10 MB (23514)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12i" });
    const svc = getServiceRoleClient();

    const zero = await svc.from("briefs").insert({
      site_id: siteId, title: "Zero",
      source_storage_path: makeStoragePath("z"),
      source_mime_type: "text/markdown",
      source_size_bytes: 0,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: makeIdempKey("z"),
    });
    expect(zero.error?.code).toBe("23514");

    const big = await svc.from("briefs").insert({
      site_id: siteId, title: "Big",
      source_storage_path: makeStoragePath("big"),
      source_mime_type: "text/markdown",
      source_size_bytes: 10485761,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: makeIdempKey("big"),
    });
    expect(big.error?.code).toBe("23514");
  });

  it("10. rejects unsupported source_mime_type (23514)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12j" });
    const svc = getServiceRoleClient();
    const res = await svc.from("briefs").insert({
      site_id: siteId, title: "PDF",
      source_storage_path: makeStoragePath("pdf"),
      source_mime_type: "application/pdf",
      source_size_bytes: 100,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: makeIdempKey("pdf"),
    });
    expect(res.error?.code).toBe("23514");
  });

  it("11. rejects brief_pages.mode outside the enum (23514)", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12k" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();
    const res = await svc.from("brief_pages").insert({
      brief_id: briefId, ordinal: 0, title: "Bad mode",
      mode: "unknown", source_text: "x", word_count: 1,
    });
    expect(res.error?.code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // 12. brief_runs lease-coherence CHECK
  // -------------------------------------------------------------------------

  it("12. brief_runs_lease_coherent rejects status='queued' with worker_id set", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12l" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();
    const res = await svc.from("brief_runs").insert({
      brief_id: briefId,
      status: "queued",
      worker_id: "bad-worker",
      lease_expires_at: new Date().toISOString(),
    });
    expect(res.error?.code).toBe("23514");
  });

  // -------------------------------------------------------------------------
  // 13. FK CASCADE
  // -------------------------------------------------------------------------

  it("13. deleting a brief cascades to brief_pages, brief_runs, site_conventions", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12m" });
    const { id: briefId } = await insertBrief({ site_id: siteId });
    const svc = getServiceRoleClient();

    await svc.from("brief_pages").insert({
      brief_id: briefId, ordinal: 0, title: "A", mode: "full_text",
      source_text: "a", word_count: 1,
    });
    await svc.from("brief_runs").insert({ brief_id: briefId, status: "queued" });
    await svc.from("site_conventions").insert({ brief_id: briefId });

    const del = await svc.from("briefs").delete().eq("id", briefId);
    expect(del.error).toBeNull();

    const pages = await svc.from("brief_pages").select("id").eq("brief_id", briefId);
    expect(pages.data).toEqual([]);
    const runs = await svc.from("brief_runs").select("id").eq("brief_id", briefId);
    expect(runs.data).toEqual([]);
    const conv = await svc.from("site_conventions").select("id").eq("brief_id", briefId);
    expect(conv.data).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 14. FK SET NULL
  // -------------------------------------------------------------------------

  it("14. deleting the referenced opollo_users row nulls created_by/updated_by/deleted_by/committed_by", async () => {
    const { id: siteId } = await seedSite({ prefix: "m12n" });
    const svc = getServiceRoleClient();

    // Re-insert this file's operator row (it survives auth.users but
    // the global TRUNCATE wipes opollo_users).
    await svc.from("opollo_users").insert({
      id: opUser.id,
      email: opUser.email,
      role: "operator",
    });

    const { id: briefId } = await insertBrief({
      site_id: siteId,
      status: "committed",
      committed_at: new Date().toISOString(),
      committed_page_hash: "abcdef123",
      created_by: opUser.id,
    });

    // Update committed_by + updated_by to the operator.
    await svc
      .from("briefs")
      .update({ committed_by: opUser.id, updated_by: opUser.id })
      .eq("id", briefId);

    // Delete the opollo_users row (keep auth.users intact via persistent).
    const delOp = await svc.from("opollo_users").delete().eq("id", opUser.id);
    expect(delOp.error).toBeNull();

    const { data } = await svc
      .from("briefs")
      .select("created_by, updated_by, committed_by")
      .eq("id", briefId)
      .single();
    expect(data?.created_by).toBeNull();
    expect(data?.updated_by).toBeNull();
    expect(data?.committed_by).toBeNull();
  });
});
