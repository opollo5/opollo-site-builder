import { describe, expect, it } from "vitest";

import {
  createPost,
  getPost,
  LIST_POSTS_DEFAULT_LIMIT,
  listPostsForSite,
  POST_CONTENT_TYPE,
  softDeletePost,
  updatePostMetadata,
} from "@/lib/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser } from "./_auth-helpers";
import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M13-1 — lib/posts.ts unit + integration tests.
//
// Pins the invariants the /admin/sites/[id]/posts surface (M13-4) will
// rely on:
//
//   1. createPost stamps content_type='post' regardless of caller input.
//   2. Site scope — a post belonging to site B never leaks via site A.
//   3. Filter composition (status + author_id + q) ANDs.
//   4. Pagination + total match.
//   5. getPost requires BOTH site_id + post_id; cross-site NOT_FOUND.
//   6. updatePostMetadata bumps version_lock, stamps last_edited_by.
//   7. VERSION_CONFLICT on stale expected_version.
//   8. UNIQUE_VIOLATION on slug collision within the same site (live
//      posts only — soft-deleted rows must not contend).
//   9. NOT_FOUND on archived post edit (deleted_at set).
//   10. softDeletePost marks deleted_at, bumps version_lock, excludes
//       from default list + detail reads.
//   11. Transitioning status → 'published' stamps published_at.
// ---------------------------------------------------------------------------

type Seed = {
  slug: string;
  title: string;
  excerpt?: string | null;
  status?: "draft" | "published" | "scheduled";
  wp_post_id?: number | null;
  author_id?: string | null;
  createdAtOffsetMs?: number;
};

async function seedPost(
  siteId: string,
  seed: Seed,
): Promise<string> {
  const svc = getServiceRoleClient();
  const now = Date.now();
  const updatedAt = new Date(
    now + (seed.createdAtOffsetMs ?? 0),
  ).toISOString();
  const row: Record<string, unknown> = {
    site_id: siteId,
    content_type: POST_CONTENT_TYPE,
    wp_post_id: seed.wp_post_id ?? null,
    slug: seed.slug,
    title: seed.title,
    excerpt: seed.excerpt ?? null,
    design_system_version: 1,
    status: seed.status ?? "draft",
    author_id: seed.author_id ?? null,
    updated_at: updatedAt,
  };
  if (seed.status === "published") {
    row.published_at = updatedAt;
  }
  const { data, error } = await svc
    .from("posts")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedPost: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

describe("createPost", () => {
  it("creates a draft post with content_type='post' and version_lock=1", async () => {
    const site = await seedSite({ name: "C1", prefix: "cp1" });
    const user = await seedAuthUser({ role: "operator" });
    const res = await createPost({
      site_id: site.id,
      title: "Hello world",
      slug: "hello-world",
      excerpt: "A first post",
      design_system_version: 1,
      created_by: user.id,
      content_brief: { topic: "greetings" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.content_type).toBe("post");
    expect(res.data.status).toBe("draft");
    expect(res.data.wp_post_id).toBeNull();
    expect(res.data.version_lock).toBe(1);
    expect(res.data.excerpt).toBe("A first post");
    expect(res.data.published_at).toBeNull();
  });

  it("surfaces UNIQUE_VIOLATION on slug collision within the same site", async () => {
    const site = await seedSite({ name: "C2", prefix: "cp2" });
    await seedPost(site.id, { slug: "taken", title: "First" });
    const res = await createPost({
      site_id: site.id,
      title: "Second",
      slug: "taken",
      design_system_version: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
    expect(res.error.details?.attempted_slug).toBe("taken");
  });

  it("allows the same slug across different sites", async () => {
    const siteA = await seedSite({ name: "CA", prefix: "cpa" });
    const siteB = await seedSite({ name: "CB", prefix: "cpb" });
    await seedPost(siteA.id, { slug: "shared", title: "Site A post" });
    const res = await createPost({
      site_id: siteB.id,
      title: "Site B post",
      slug: "shared",
      design_system_version: 1,
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a title shorter than the minimum with VALIDATION_FAILED", async () => {
    const site = await seedSite({ name: "C3", prefix: "cp3" });
    const res = await createPost({
      site_id: site.id,
      title: "Hi",
      slug: "hi",
      design_system_version: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an invalid slug format with VALIDATION_FAILED", async () => {
    const site = await seedSite({ name: "C4", prefix: "cp4" });
    const res = await createPost({
      site_id: site.id,
      title: "Valid title",
      slug: "Bad Slug!",
      design_system_version: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// listPostsForSite — site scope + filters + pagination
// ---------------------------------------------------------------------------

describe("listPostsForSite — site scoping", () => {
  it("returns only rows belonging to the given site", async () => {
    const siteA = await seedSite({ name: "LA", prefix: "la1" });
    const siteB = await seedSite({ name: "LB", prefix: "lb1" });
    const aId = await seedPost(siteA.id, { slug: "a-hi", title: "A hi" });
    const bId = await seedPost(siteB.id, { slug: "b-hi", title: "B hi" });

    const res = await listPostsForSite(siteA.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toContain(aId);
    expect(ids).not.toContain(bId);
    expect(res.data.total).toBe(1);
  });

  it("excludes soft-deleted posts by default", async () => {
    const site = await seedSite({ name: "LD", prefix: "ld1" });
    const liveId = await seedPost(site.id, { slug: "live", title: "Live" });
    const archivedId = await seedPost(site.id, {
      slug: "gone",
      title: "Gone",
    });
    const svc = getServiceRoleClient();
    await svc
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", archivedId);

    const res = await listPostsForSite(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(archivedId);
    expect(res.data.total).toBe(1);
  });

  it("includes soft-deleted posts when include_archived=true", async () => {
    const site = await seedSite({ name: "LDi", prefix: "ldi1" });
    const archivedId = await seedPost(site.id, {
      slug: "gone-2",
      title: "Gone again",
    });
    const svc = getServiceRoleClient();
    await svc
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", archivedId);

    const res = await listPostsForSite(site.id, { include_archived: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toContain(archivedId);
  });
});

describe("listPostsForSite — filter composition", () => {
  it("applies status filter", async () => {
    const site = await seedSite({ name: "LS", prefix: "ls1" });
    const draftId = await seedPost(site.id, {
      slug: "d",
      title: "Draft",
      status: "draft",
    });
    await seedPost(site.id, {
      slug: "p",
      title: "Pub",
      status: "published",
    });
    const res = await listPostsForSite(site.id, { status: "draft" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([draftId]);
  });

  it("applies author_id filter", async () => {
    const site = await seedSite({ name: "LAu", prefix: "lau1" });
    const alice = await seedAuthUser({ role: "operator" });
    const bob = await seedAuthUser({ role: "operator" });
    const aliceId = await seedPost(site.id, {
      slug: "alice",
      title: "Alice",
      author_id: alice.id,
    });
    await seedPost(site.id, {
      slug: "bob",
      title: "Bob",
      author_id: bob.id,
    });
    const res = await listPostsForSite(site.id, { author_id: alice.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([aliceId]);
  });

  it("applies free-text search on title + slug (ILIKE)", async () => {
    const site = await seedSite({ name: "LQ", prefix: "lq1" });
    const matchId = await seedPost(site.id, {
      slug: "kadence-guide",
      title: "Kadence tuning guide",
    });
    await seedPost(site.id, { slug: "intro", title: "Intro" });
    const res = await listPostsForSite(site.id, { query: "kadence" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });

  it("strips ILIKE wildcards from operator input", async () => {
    const site = await seedSite({ name: "LW", prefix: "lw1" });
    const matchId = await seedPost(site.id, {
      slug: "kadence",
      title: "Kadence",
    });
    await seedPost(site.id, { slug: "intro", title: "Intro" });
    const res = await listPostsForSite(site.id, { query: "kadence*" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });
});

describe("listPostsForSite — pagination + ordering", () => {
  it("orders by updated_at desc", async () => {
    const site = await seedSite({ name: "LO", prefix: "lo1" });
    const oldId = await seedPost(site.id, {
      slug: "old",
      title: "Old",
      createdAtOffsetMs: -60_000,
    });
    const newId = await seedPost(site.id, {
      slug: "new",
      title: "New",
      createdAtOffsetMs: -1_000,
    });
    const res = await listPostsForSite(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([newId, oldId]);
  });

  it("windows results + reports total", async () => {
    const site = await seedSite({ name: "LP", prefix: "lp1" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedPost(site.id, {
          slug: `p-${i}`,
          title: `Post ${i}`,
          createdAtOffsetMs: i * 1000,
        }),
      );
    }
    const pg1 = await listPostsForSite(site.id, { limit: 2, offset: 0 });
    expect(pg1.ok).toBe(true);
    if (!pg1.ok) return;
    expect(pg1.data.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    expect(pg1.data.total).toBe(5);

    const pg2 = await listPostsForSite(site.id, { limit: 2, offset: 2 });
    expect(pg2.ok).toBe(true);
    if (!pg2.ok) return;
    expect(pg2.data.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
  });

  it("defaults to LIST_POSTS_DEFAULT_LIMIT when limit omitted", async () => {
    const site = await seedSite({ name: "LD2", prefix: "ld2" });
    await seedPost(site.id, { slug: "only", title: "Only" });
    const res = await listPostsForSite(site.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.limit).toBe(LIST_POSTS_DEFAULT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// getPost — cross-site guard + NOT_FOUND + detail shape
// ---------------------------------------------------------------------------

describe("getPost — site scope guard", () => {
  it("returns NOT_FOUND when the post belongs to another site", async () => {
    const siteA = await seedSite({ name: "GA", prefix: "gxa" });
    const siteB = await seedSite({ name: "GB", prefix: "gxb" });
    const postB = await seedPost(siteB.id, { slug: "b-home", title: "B" });
    const res = await getPost(siteA.id, postB);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns detail when scope matches", async () => {
    const site = await seedSite({ name: "GS", prefix: "gxs" });
    const postId = await seedPost(site.id, {
      slug: "home",
      title: "Home",
    });
    const res = await getPost(site.id, postId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(postId);
    expect(res.data.site_name).toBe("GS");
    expect(res.data.site_wp_url).toBe("https://gxs.test");
    expect(res.data.content_type).toBe("post");
    expect(res.data.version_lock).toBe(1);
  });

  it("returns NOT_FOUND for an archived post by default", async () => {
    const site = await seedSite({ name: "GD", prefix: "gxd" });
    const postId = await seedPost(site.id, {
      slug: "archived",
      title: "Archived",
    });
    const svc = getServiceRoleClient();
    await svc
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", postId);
    const res = await getPost(site.id, postId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns archived post when include_archived=true", async () => {
    const site = await seedSite({ name: "GDi", prefix: "gxdi" });
    const postId = await seedPost(site.id, {
      slug: "archived-2",
      title: "Archived 2",
    });
    const svc = getServiceRoleClient();
    await svc
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", postId);
    const res = await getPost(site.id, postId, { include_archived: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updatePostMetadata — happy paths + error paths
// ---------------------------------------------------------------------------

describe("updatePostMetadata — happy path", () => {
  it("updates title + slug + excerpt and bumps version_lock", async () => {
    const site = await seedSite({ name: "U1", prefix: "u1p" });
    const postId = await seedPost(site.id, {
      slug: "orig",
      title: "Original title",
    });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: {
        title: "Rewritten title",
        slug: "rewritten",
        excerpt: "New excerpt",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.title).toBe("Rewritten title");
    expect(res.data.slug).toBe("rewritten");
    expect(res.data.excerpt).toBe("New excerpt");
    expect(res.data.version_lock).toBe(2);
  });

  it("stamps last_edited_by when updated_by is supplied", async () => {
    const site = await seedSite({ name: "U2", prefix: "u2p" });
    const postId = await seedPost(site.id, {
      slug: "attrib",
      title: "Attrib",
    });
    const user = await seedAuthUser({ role: "operator" });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      updated_by: user.id,
      patch: { title: "Edited title" },
    });
    expect(res.ok).toBe(true);

    const svc = getServiceRoleClient();
    const readBack = await svc
      .from("posts")
      .select("last_edited_by, updated_by")
      .eq("id", postId)
      .maybeSingle();
    expect(readBack.data?.last_edited_by).toBe(user.id);
    expect(readBack.data?.updated_by).toBe(user.id);
  });

  it("stamps published_at when transitioning status to published", async () => {
    const site = await seedSite({ name: "U3", prefix: "u3p" });
    const postId = await seedPost(site.id, {
      slug: "pub-me",
      title: "Draft",
    });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { status: "published" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("published");
    expect(res.data.published_at).not.toBeNull();
  });

  it("accepts an excerpt-only patch without touching title or slug", async () => {
    const site = await seedSite({ name: "U4", prefix: "u4p" });
    const postId = await seedPost(site.id, {
      slug: "keep",
      title: "Keep",
      excerpt: "Old excerpt",
    });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { excerpt: "New excerpt only" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.excerpt).toBe("New excerpt only");
    expect(res.data.slug).toBe("keep");
    expect(res.data.title).toBe("Keep");
  });
});

describe("updatePostMetadata — error paths", () => {
  it("returns VERSION_CONFLICT on stale expected_version", async () => {
    const site = await seedSite({ name: "E1", prefix: "e1p" });
    const postId = await seedPost(site.id, {
      slug: "conflict",
      title: "Original",
    });
    await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { title: "Round one" },
    });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { title: "Stale clobber" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
    expect(res.error.details?.current_version).toBe(2);
  });

  it("returns UNIQUE_VIOLATION when slug collides on the same site", async () => {
    const site = await seedSite({ name: "E2", prefix: "e2p" });
    await seedPost(site.id, { slug: "taken", title: "First" });
    const secondId = await seedPost(site.id, {
      slug: "free",
      title: "Second",
    });
    const res = await updatePostMetadata(site.id, secondId, {
      expected_version: 1,
      patch: { slug: "taken" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
    expect(res.error.details?.attempted_slug).toBe("taken");
  });

  it("allows the same slug to exist on a different site", async () => {
    const siteA = await seedSite({ name: "EA", prefix: "eapa" });
    const siteB = await seedSite({ name: "EB", prefix: "eapb" });
    await seedPost(siteA.id, { slug: "shared", title: "A" });
    const bPost = await seedPost(siteB.id, {
      slug: "original",
      title: "B",
    });
    const res = await updatePostMetadata(siteB.id, bPost, {
      expected_version: 1,
      patch: { slug: "shared" },
    });
    expect(res.ok).toBe(true);
  });

  it("returns NOT_FOUND when the post doesn't exist under the site", async () => {
    const site = await seedSite({ name: "E3", prefix: "e3p" });
    const res = await updatePostMetadata(
      site.id,
      "00000000-0000-0000-0000-000000000000",
      { expected_version: 1, patch: { title: "nope" } },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND on archived post", async () => {
    const site = await seedSite({ name: "E4", prefix: "e4p" });
    const postId = await seedPost(site.id, {
      slug: "gone",
      title: "Gone",
    });
    const svc = getServiceRoleClient();
    await svc
      .from("posts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", postId);
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { title: "can't edit" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
    expect(res.error.details?.archived).toBe(true);
  });

  it("rejects an invalid slug in the patch with VALIDATION_FAILED", async () => {
    const site = await seedSite({ name: "E5", prefix: "e5p" });
    const postId = await seedPost(site.id, {
      slug: "clean",
      title: "Clean",
    });
    const res = await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { slug: "BAD SLUG" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// softDeletePost
// ---------------------------------------------------------------------------

describe("softDeletePost", () => {
  it("marks deleted_at + bumps version_lock and excludes from default reads", async () => {
    const site = await seedSite({ name: "S1", prefix: "s1p" });
    const user = await seedAuthUser({ role: "operator" });
    const postId = await seedPost(site.id, { slug: "rm", title: "Remove me" });
    const res = await softDeletePost(site.id, postId, {
      expected_version: 1,
      deleted_by: user.id,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.version_lock).toBe(2);
    expect(res.data.deleted_at).toBeTruthy();

    const list = await listPostsForSite(site.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.items.map((i) => i.id)).not.toContain(postId);
  });

  it("frees the slug for a new live post after soft-delete", async () => {
    const site = await seedSite({ name: "S2", prefix: "s2p" });
    const archivedId = await seedPost(site.id, {
      slug: "slot",
      title: "Archived",
    });
    await softDeletePost(site.id, archivedId, { expected_version: 1 });
    const res = await createPost({
      site_id: site.id,
      title: "Fresh",
      slug: "slot",
      design_system_version: 1,
    });
    expect(res.ok).toBe(true);
  });

  it("returns VERSION_CONFLICT on stale expected_version", async () => {
    const site = await seedSite({ name: "S3", prefix: "s3p" });
    const postId = await seedPost(site.id, {
      slug: "bumped",
      title: "Bumped",
    });
    await updatePostMetadata(site.id, postId, {
      expected_version: 1,
      patch: { title: "Bumped once" },
    });
    const res = await softDeletePost(site.id, postId, { expected_version: 1 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
  });
});
