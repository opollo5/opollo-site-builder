import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-1 schema tests — posts table constraints.
//
// Pins the invariants lib/posts.ts + the M13-3 runner + the M13-4
// admin surface rely on:
//
//   - content_type CHECK: only 'post' accepted.
//   - version_lock CHECK: >= 1 at insert, >= 1 after update.
//   - design_system_version CHECK: >= 1.
//   - status CHECK: 'draft' | 'published' | 'scheduled'.
//   - posts_published_at_coherent: status='published' requires
//     published_at NOT NULL.
//   - Partial UNIQUE (site_id, wp_post_id) WHERE wp_post_id IS NOT NULL:
//     NULL is distinct (many drafts coexist); published collisions blow
//     up with 23505.
//   - Partial UNIQUE (site_id, slug) WHERE deleted_at IS NULL: two live
//     posts on the same site cannot share a slug; soft-deleted rows
//     don't contend.
//   - FK site_id ON DELETE CASCADE.
//   - FK author_id / created_by / updated_by / deleted_by /
//     last_edited_by SET NULL on opollo_users delete.
//   - FK template_id SET NULL on design_templates delete.
// ---------------------------------------------------------------------------

function randomSlug(suffix: string): string {
  return `m13-1-${suffix}-${Math.random().toString(36).slice(2, 10)}`;
}

async function insertPost(opts: {
  site_id: string;
  slug?: string;
  title?: string;
  status?: string;
  wp_post_id?: number | null;
  content_type?: string;
  design_system_version?: number;
  version_lock?: number;
  published_at?: string | null;
  author_id?: string | null;
  deleted_at?: string | null;
  allowError?: boolean;
}): Promise<{ id: string | null; error: { code?: string; message: string } | null }> {
  const svc = getServiceRoleClient();
  const row: Record<string, unknown> = {
    site_id: opts.site_id,
    slug: opts.slug ?? randomSlug("slug"),
    title: opts.title ?? "Test Post",
    status: opts.status ?? "draft",
    design_system_version: opts.design_system_version ?? 1,
  };
  if (opts.content_type !== undefined) row.content_type = opts.content_type;
  if (opts.wp_post_id !== undefined) row.wp_post_id = opts.wp_post_id;
  if (opts.version_lock !== undefined) row.version_lock = opts.version_lock;
  if (opts.published_at !== undefined) row.published_at = opts.published_at;
  if (opts.author_id !== undefined) row.author_id = opts.author_id;
  if (opts.deleted_at !== undefined) row.deleted_at = opts.deleted_at;

  const { data, error } = await svc
    .from("posts")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    if (opts.allowError) {
      return {
        id: null,
        error: { code: error.code, message: error.message },
      };
    }
    throw new Error(`insertPost failed: ${error.message}`);
  }
  return { id: data.id as string, error: null };
}

// ---------------------------------------------------------------------------
// CHECK constraints
// ---------------------------------------------------------------------------

describe("posts — content_type CHECK", () => {
  it("accepts content_type='post' (the default)", async () => {
    const site = await seedSite({ name: "CT1", prefix: "ct1p" });
    const res = await insertPost({ site_id: site.id });
    expect(res.id).not.toBeNull();
  });

  it("rejects content_type='page'", async () => {
    const site = await seedSite({ name: "CT2", prefix: "ct2p" });
    const res = await insertPost({
      site_id: site.id,
      content_type: "page",
      allowError: true,
    });
    expect(res.error?.message).toMatch(/content_type/i);
  });

  it("rejects content_type='video'", async () => {
    const site = await seedSite({ name: "CT3", prefix: "ct3p" });
    const res = await insertPost({
      site_id: site.id,
      content_type: "video",
      allowError: true,
    });
    expect(res.error).not.toBeNull();
  });
});

describe("posts — status CHECK", () => {
  it("accepts 'draft'", async () => {
    const site = await seedSite({ name: "ST1", prefix: "st1p" });
    const res = await insertPost({ site_id: site.id, status: "draft" });
    expect(res.id).not.toBeNull();
  });

  it("accepts 'published' when published_at is also set", async () => {
    const site = await seedSite({ name: "ST2", prefix: "st2p" });
    const res = await insertPost({
      site_id: site.id,
      status: "published",
      published_at: new Date().toISOString(),
    });
    expect(res.id).not.toBeNull();
  });

  it("accepts 'scheduled' (forward-facing; scheduler not wired yet)", async () => {
    const site = await seedSite({ name: "ST3", prefix: "st3p" });
    const res = await insertPost({ site_id: site.id, status: "scheduled" });
    expect(res.id).not.toBeNull();
  });

  it("rejects an invalid status value", async () => {
    const site = await seedSite({ name: "ST4", prefix: "st4p" });
    const res = await insertPost({
      site_id: site.id,
      status: "trash",
      allowError: true,
    });
    expect(res.error).not.toBeNull();
  });
});

describe("posts — posts_published_at_coherent CHECK", () => {
  it("rejects status='published' with NULL published_at", async () => {
    const site = await seedSite({ name: "PC1", prefix: "pc1p" });
    const res = await insertPost({
      site_id: site.id,
      status: "published",
      published_at: null,
      allowError: true,
    });
    expect(res.error?.message).toMatch(/published_at_coherent|published_at/i);
  });

  it("allows status='draft' with NULL published_at", async () => {
    const site = await seedSite({ name: "PC2", prefix: "pc2p" });
    const res = await insertPost({
      site_id: site.id,
      status: "draft",
      published_at: null,
    });
    expect(res.id).not.toBeNull();
  });

  it("allows status='scheduled' with NULL published_at", async () => {
    const site = await seedSite({ name: "PC3", prefix: "pc3p" });
    const res = await insertPost({
      site_id: site.id,
      status: "scheduled",
      published_at: null,
    });
    expect(res.id).not.toBeNull();
  });
});

describe("posts — version_lock + design_system_version CHECK", () => {
  it("rejects version_lock < 1", async () => {
    const site = await seedSite({ name: "V1", prefix: "v1p" });
    const res = await insertPost({
      site_id: site.id,
      version_lock: 0,
      allowError: true,
    });
    expect(res.error?.message).toMatch(/version_lock/i);
  });

  it("rejects design_system_version < 1", async () => {
    const site = await seedSite({ name: "V2", prefix: "v2p" });
    const res = await insertPost({
      site_id: site.id,
      design_system_version: 0,
      allowError: true,
    });
    expect(res.error?.message).toMatch(/design_system_version/i);
  });
});

// ---------------------------------------------------------------------------
// Partial UNIQUE indexes
// ---------------------------------------------------------------------------

describe("posts — (site_id, wp_post_id) partial UNIQUE treats NULL as distinct", () => {
  it("allows multiple drafts with NULL wp_post_id", async () => {
    const site = await seedSite({ name: "WU1", prefix: "wu1p" });
    const a = await insertPost({ site_id: site.id, wp_post_id: null });
    const b = await insertPost({ site_id: site.id, wp_post_id: null });
    expect(a.id).not.toBeNull();
    expect(b.id).not.toBeNull();
  });

  it("rejects two published posts with the same (site_id, wp_post_id)", async () => {
    const site = await seedSite({ name: "WU2", prefix: "wu2p" });
    const wpId = 12345;
    const a = await insertPost({
      site_id: site.id,
      wp_post_id: wpId,
      status: "published",
      published_at: new Date().toISOString(),
    });
    expect(a.id).not.toBeNull();
    const b = await insertPost({
      site_id: site.id,
      wp_post_id: wpId,
      status: "published",
      published_at: new Date().toISOString(),
      allowError: true,
    });
    expect(b.error?.code).toBe("23505");
  });

  it("allows the same wp_post_id across different sites", async () => {
    const siteA = await seedSite({ name: "WU3A", prefix: "wu3a" });
    const siteB = await seedSite({ name: "WU3B", prefix: "wu3b" });
    const a = await insertPost({
      site_id: siteA.id,
      wp_post_id: 777,
      status: "published",
      published_at: new Date().toISOString(),
    });
    const b = await insertPost({
      site_id: siteB.id,
      wp_post_id: 777,
      status: "published",
      published_at: new Date().toISOString(),
    });
    expect(a.id).not.toBeNull();
    expect(b.id).not.toBeNull();
  });
});

describe("posts — (site_id, slug) partial UNIQUE ignores soft-deleted rows", () => {
  it("rejects two live posts sharing a slug on the same site", async () => {
    const site = await seedSite({ name: "SU1", prefix: "su1p" });
    const slug = randomSlug("dup");
    const a = await insertPost({ site_id: site.id, slug });
    expect(a.id).not.toBeNull();
    const b = await insertPost({
      site_id: site.id,
      slug,
      allowError: true,
    });
    expect(b.error?.code).toBe("23505");
  });

  it("permits reuse of a slug after the original is soft-deleted", async () => {
    const site = await seedSite({ name: "SU2", prefix: "su2p" });
    const slug = randomSlug("reuse");
    const a = await insertPost({
      site_id: site.id,
      slug,
      deleted_at: new Date().toISOString(),
    });
    expect(a.id).not.toBeNull();
    const b = await insertPost({ site_id: site.id, slug });
    expect(b.id).not.toBeNull();
  });

  it("allows the same slug on different sites", async () => {
    const siteA = await seedSite({ name: "SU3A", prefix: "su3a" });
    const siteB = await seedSite({ name: "SU3B", prefix: "su3b" });
    const slug = randomSlug("shared");
    const a = await insertPost({ site_id: siteA.id, slug });
    const b = await insertPost({ site_id: siteB.id, slug });
    expect(a.id).not.toBeNull();
    expect(b.id).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Foreign keys
// ---------------------------------------------------------------------------

describe("posts — foreign keys", () => {
  it("cascades posts on site delete", async () => {
    const site = await seedSite({ name: "FK1", prefix: "fk1p" });
    const a = await insertPost({ site_id: site.id });
    const svc = getServiceRoleClient();
    const del = await svc.from("sites").delete().eq("id", site.id);
    expect(del.error).toBeNull();

    const read = await svc
      .from("posts")
      .select("id")
      .eq("id", a.id as string)
      .maybeSingle();
    expect(read.error).toBeNull();
    expect(read.data).toBeNull();
  });
});
