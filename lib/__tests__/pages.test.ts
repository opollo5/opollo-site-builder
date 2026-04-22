import { describe, expect, it } from "vitest";

import {
  getPage,
  LIST_PAGES_DEFAULT_LIMIT,
  listPagesForSite,
  updatePageMetadata,
} from "@/lib/pages";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M6-1 — listPagesForSite + getPage unit tests.
//
// Pins the invariants the /admin/sites/[id]/pages surface relies on:
//
//   1. Site scope — a page belonging to site B never leaks via a site A query.
//   2. Filters compose (status + page_type + q) with AND semantics.
//   3. Pagination window + count match.
//   4. getPage requires BOTH site_id + page_id; cross-site access NOT_FOUND.
//   5. q query escapes ILIKE wildcards so operator input can't glob.
// ---------------------------------------------------------------------------

type Seed = {
  slug: string;
  title: string;
  page_type?: string;
  status?: "draft" | "published";
  wp_page_id?: number;
  createdAtOffsetMs?: number;
};

async function seedSite(opts: {
  name: string;
  prefix: string;
}): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("sites")
    .insert({
      name: opts.name,
      prefix: opts.prefix,
      wp_url: `https://${opts.prefix}.example`,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedSite: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

async function seedPage(siteId: string, seed: Seed): Promise<string> {
  const svc = getServiceRoleClient();
  const now = Date.now();
  const updatedAt = new Date(
    now + (seed.createdAtOffsetMs ?? 0),
  ).toISOString();
  const { data, error } = await svc
    .from("pages")
    .insert({
      site_id: siteId,
      wp_page_id: seed.wp_page_id ?? Math.floor(Math.random() * 1_000_000),
      slug: seed.slug,
      title: seed.title,
      page_type: seed.page_type ?? "homepage",
      design_system_version: 1,
      status: seed.status ?? "draft",
      updated_at: updatedAt,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedPage: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Site scope
// ---------------------------------------------------------------------------

describe("listPagesForSite — site scoping", () => {
  it("returns only rows belonging to the given site", async () => {
    const siteA = await seedSite({ name: "Alpha", prefix: "a1" });
    const siteB = await seedSite({ name: "Bravo", prefix: "b1" });
    const aId = await seedPage(siteA, {
      slug: "a-home",
      title: "Alpha home",
    });
    const bId = await seedPage(siteB, {
      slug: "b-home",
      title: "Bravo home",
    });

    const res = await listPagesForSite(siteA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toContain(aId);
    expect(ids).not.toContain(bId);
    expect(res.data.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filter composition
// ---------------------------------------------------------------------------

describe("listPagesForSite — filter composition", () => {
  it("applies status filter", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s1" });
    const draftId = await seedPage(siteId, {
      slug: "drafty",
      title: "Draft",
      status: "draft",
    });
    await seedPage(siteId, {
      slug: "pub",
      title: "Published",
      status: "published",
    });
    const res = await listPagesForSite(siteId, { status: "draft" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([draftId]);
  });

  it("applies page_type filter", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s2" });
    const homeId = await seedPage(siteId, {
      slug: "home",
      title: "Home",
      page_type: "homepage",
    });
    await seedPage(siteId, {
      slug: "intg",
      title: "Integration",
      page_type: "integration",
    });
    const res = await listPagesForSite(siteId, { page_type: "homepage" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([homeId]);
  });

  it("applies free-text search on title + slug (ILIKE)", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s3" });
    const matchId = await seedPage(siteId, {
      slug: "managed-it",
      title: "Managed IT services",
    });
    await seedPage(siteId, {
      slug: "about",
      title: "About us",
    });
    const res = await listPagesForSite(siteId, { query: "managed" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });

  it("matches via slug even when title doesn't contain the query", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s4" });
    const matchId = await seedPage(siteId, {
      slug: "cloud-backup",
      title: "Backup Services",
    });
    const res = await listPagesForSite(siteId, { query: "cloud" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });

  it("strips ILIKE wildcards from operator input", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s5" });
    const matchId = await seedPage(siteId, {
      slug: "cloud",
      title: "Cloud",
    });
    await seedPage(siteId, {
      slug: "about",
      title: "About",
    });
    // Operator types "cloud*" hoping for glob — we strip the wildcard
    // so the query becomes a literal "cloud" substring match.
    const res = await listPagesForSite(siteId, { query: "cloud*" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });

  it("composes status + page_type + query (AND)", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s6" });
    const matchId = await seedPage(siteId, {
      slug: "cloud-help",
      title: "Cloud help",
      page_type: "troubleshooting",
      status: "draft",
    });
    await seedPage(siteId, {
      slug: "cloud-intg",
      title: "Cloud integration",
      page_type: "integration",
      status: "draft",
    });
    await seedPage(siteId, {
      slug: "cloud-help-pub",
      title: "Cloud help published",
      page_type: "troubleshooting",
      status: "published",
    });
    const res = await listPagesForSite(siteId, {
      status: "draft",
      page_type: "troubleshooting",
      query: "cloud",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });
});

// ---------------------------------------------------------------------------
// Pagination + ordering
// ---------------------------------------------------------------------------

describe("listPagesForSite — pagination + ordering", () => {
  it("orders by updated_at desc (newest first)", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s7" });
    const oldId = await seedPage(siteId, {
      slug: "old",
      title: "Old",
      createdAtOffsetMs: -60_000,
    });
    const newId = await seedPage(siteId, {
      slug: "new",
      title: "New",
      createdAtOffsetMs: -1_000,
    });
    const res = await listPagesForSite(siteId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([newId, oldId]);
  });

  it("windows results by limit + offset and reports accurate total", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s8" });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedPage(siteId, {
          slug: `p-${i}`,
          title: `Page ${i}`,
          createdAtOffsetMs: i * 1000,
        }),
      );
    }

    const page1 = await listPagesForSite(siteId, { limit: 2, offset: 0 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.data.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    expect(page1.data.total).toBe(5);
    expect(page1.data.limit).toBe(2);

    const page2 = await listPagesForSite(siteId, { limit: 2, offset: 2 });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.data.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
  });

  it("defaults to LIST_PAGES_DEFAULT_LIMIT when limit omitted", async () => {
    const siteId = await seedSite({ name: "S", prefix: "s9" });
    await seedPage(siteId, { slug: "one", title: "One" });
    const res = await listPagesForSite(siteId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.limit).toBe(LIST_PAGES_DEFAULT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// getPage — cross-site guard + NOT_FOUND
// ---------------------------------------------------------------------------

describe("getPage — site scope guard", () => {
  it("returns NOT_FOUND when the page belongs to a different site", async () => {
    const siteA = await seedSite({ name: "Alpha", prefix: "ga" });
    const siteB = await seedSite({ name: "Bravo", prefix: "gb" });
    const pageB = await seedPage(siteB, {
      slug: "bravo-home",
      title: "Bravo Home",
    });
    // Attempting to fetch site B's page via site A's scope.
    const res = await getPage(siteA, pageB);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns the page detail when scope matches", async () => {
    const siteId = await seedSite({ name: "Scoped", prefix: "sc" });
    const pageId = await seedPage(siteId, {
      slug: "scoped-home",
      title: "Scoped Home",
    });
    const res = await getPage(siteId, pageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(pageId);
    expect(res.data.site_id).toBe(siteId);
    expect(res.data.site_name).toBe("Scoped");
    expect(res.data.site_wp_url).toBe("https://sc.example");
    expect(res.data.version_lock).toBe(1);
  });

  it("returns NOT_FOUND for an unknown page id", async () => {
    const siteId = await seedSite({ name: "S", prefix: "sn" });
    const res = await getPage(siteId, "00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// updatePageMetadata — optimistic-locked edits (M6-3)
// ---------------------------------------------------------------------------

describe("updatePageMetadata — happy path", () => {
  it("updates title + slug and bumps version_lock", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u1" });
    const pageId = await seedPage(siteId, {
      slug: "original-slug",
      title: "Original title",
    });
    const res = await updatePageMetadata(siteId, pageId, {
      expected_version: 1,
      patch: { title: "New title", slug: "new-slug" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.title).toBe("New title");
    expect(res.data.slug).toBe("new-slug");
    expect(res.data.version_lock).toBe(2);
  });

  it("applies a title-only patch without touching slug", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u2" });
    const pageId = await seedPage(siteId, {
      slug: "keep-me",
      title: "Old",
    });
    const res = await updatePageMetadata(siteId, pageId, {
      expected_version: 1,
      patch: { title: "New only" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.title).toBe("New only");
    expect(res.data.slug).toBe("keep-me");
  });

  it("stamps last_edited_by when updated_by is supplied", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u3" });
    const pageId = await seedPage(siteId, {
      slug: "attributed",
      title: "Attributed",
    });
    const user = await seedAuthUser({ role: "admin" });
    const res = await updatePageMetadata(siteId, pageId, {
      expected_version: 1,
      updated_by: user.id,
      patch: { title: "Edited by operator" },
    });
    expect(res.ok).toBe(true);

    const svc = getServiceRoleClient();
    const readBack = await svc
      .from("pages")
      .select("last_edited_by")
      .eq("id", pageId)
      .maybeSingle();
    expect(readBack.data?.last_edited_by).toBe(user.id);
  });
});

describe("updatePageMetadata — error paths", () => {
  it("returns VERSION_CONFLICT when expected_version is stale", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u4" });
    const pageId = await seedPage(siteId, {
      slug: "conflict",
      title: "Original",
    });
    // First edit bumps version_lock to 2.
    await updatePageMetadata(siteId, pageId, {
      expected_version: 1,
      patch: { title: "Round one" },
    });
    // Stale edit must fail.
    const res = await updatePageMetadata(siteId, pageId, {
      expected_version: 1,
      patch: { title: "Stale clobber" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
    expect(res.error.details?.current_version).toBe(2);
  });

  it("returns UNIQUE_VIOLATION when slug collides with another page on the same site", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u5" });
    await seedPage(siteId, { slug: "taken", title: "First" });
    const secondId = await seedPage(siteId, {
      slug: "free",
      title: "Second",
    });
    const res = await updatePageMetadata(siteId, secondId, {
      expected_version: 1,
      patch: { slug: "taken" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNIQUE_VIOLATION");
    expect(res.error.details?.attempted_slug).toBe("taken");
  });

  it("allows the same slug to exist on a different site", async () => {
    const siteA = await seedSite({ name: "A", prefix: "u6a" });
    const siteB = await seedSite({ name: "B", prefix: "u6b" });
    await seedPage(siteA, { slug: "shared", title: "A home" });
    const bPage = await seedPage(siteB, { slug: "original", title: "B home" });
    const res = await updatePageMetadata(siteB, bPage, {
      expected_version: 1,
      patch: { slug: "shared" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.slug).toBe("shared");
  });

  it("returns NOT_FOUND when the page doesn't exist under the given site", async () => {
    const siteId = await seedSite({ name: "S", prefix: "u7" });
    const res = await updatePageMetadata(
      siteId,
      "00000000-0000-0000-0000-000000000000",
      { expected_version: 1, patch: { title: "whatever" } },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND when the page belongs to another site (cross-site guard)", async () => {
    const siteA = await seedSite({ name: "A", prefix: "u8a" });
    const siteB = await seedSite({ name: "B", prefix: "u8b" });
    const pageB = await seedPage(siteB, { slug: "b-page", title: "B" });
    const res = await updatePageMetadata(siteA, pageB, {
      expected_version: 1,
      patch: { title: "hijack attempt" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});
