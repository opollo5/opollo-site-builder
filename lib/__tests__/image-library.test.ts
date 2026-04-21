import { describe, expect, it } from "vitest";

import {
  LIST_IMAGES_DEFAULT_LIMIT,
  LIST_IMAGES_MAX_LIMIT,
  getImage,
  listImages,
  updateImageMetadata,
} from "@/lib/image-library";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M5-1 — listImages unit tests.
//
// Pins the invariants the /admin/images server page relies on:
//
//   1. Deleted rows are hidden by default; the deleted-only view
//      surfaces them.
//   2. The FTS + tag + source filters compose via AND.
//   3. Pagination windowing + total count match what the UI shows.
//   4. Limit / offset are clamped — bogus URL params can't ask for 100k
//      rows or negative offsets.
//   5. Order is created_at desc — newest first.
// ---------------------------------------------------------------------------

type Seed = {
  source_ref: string;
  filename?: string;
  caption?: string | null;
  alt_text?: string | null;
  tags?: string[];
  source?: "istock" | "upload" | "generated";
  deleted?: boolean;
  createdAtOffsetMs?: number;
};

async function seedImage(seed: Seed): Promise<string> {
  const svc = getServiceRoleClient();
  const now = Date.now();
  const createdAt = new Date(
    now + (seed.createdAtOffsetMs ?? 0),
  ).toISOString();
  const { data, error } = await svc
    .from("image_library")
    .insert({
      source: seed.source ?? "istock",
      source_ref: seed.source_ref,
      filename: seed.filename ?? `${seed.source_ref}.jpg`,
      caption: seed.caption ?? null,
      alt_text: seed.alt_text ?? null,
      tags: seed.tags ?? [],
      width_px: 1024,
      height_px: 768,
      created_at: createdAt,
      deleted_at: seed.deleted ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedImage(${seed.source_ref}): ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Soft-delete filtering
// ---------------------------------------------------------------------------

describe("listImages — soft-delete filtering", () => {
  it("excludes soft-deleted rows by default", async () => {
    const activeId = await seedImage({
      source_ref: "s-active",
      caption: "Active image",
      tags: ["cat"],
    });
    const deletedId = await seedImage({
      source_ref: "s-deleted",
      caption: "Deleted image",
      tags: ["cat"],
      deleted: true,
    });
    const res = await listImages();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(deletedId);
    expect(res.data.total).toBe(1);
  });

  it("surfaces soft-deleted rows when deleted: true", async () => {
    await seedImage({
      source_ref: "s-active",
      caption: "Active image",
    });
    const deletedId = await seedImage({
      source_ref: "s-deleted",
      caption: "Deleted image",
      deleted: true,
    });
    const res = await listImages({ deleted: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toEqual([deletedId]);
    expect(res.data.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Filter composition (AND semantics)
// ---------------------------------------------------------------------------

describe("listImages — filter composition", () => {
  it("applies FTS query against caption", async () => {
    const catId = await seedImage({
      source_ref: "s-cat",
      caption: "A tabby cat sitting on a windowsill in morning light.",
      tags: ["cat", "indoor"],
    });
    await seedImage({
      source_ref: "s-river",
      caption: "A wide river cutting through a forest valley at dusk.",
      tags: ["river"],
    });
    const res = await listImages({ query: "cat" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([catId]);
    expect(res.data.total).toBe(1);
  });

  it("applies tag AND filter — every supplied tag must be present", async () => {
    const indoorCatId = await seedImage({
      source_ref: "s-indoor-cat",
      caption: "Indoor cat shot.",
      tags: ["cat", "indoor"],
    });
    await seedImage({
      source_ref: "s-outdoor-cat",
      caption: "Outdoor cat shot.",
      tags: ["cat", "outdoor"],
    });
    const res = await listImages({ tags: ["cat", "indoor"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([indoorCatId]);
  });

  it("applies source filter", async () => {
    const istockId = await seedImage({
      source_ref: "s-istock",
      caption: "Stock photo.",
      source: "istock",
    });
    await seedImage({
      source_ref: "s-upload",
      caption: "Operator upload.",
      source: "upload",
    });
    const res = await listImages({ source: "istock" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([istockId]);
  });

  it("composes query + tags + source (AND)", async () => {
    const matchId = await seedImage({
      source_ref: "s-match",
      caption: "A tabby cat in a studio environment.",
      tags: ["cat", "studio"],
      source: "istock",
    });
    await seedImage({
      source_ref: "s-tag-miss",
      caption: "A tabby cat in a studio environment.",
      tags: ["cat"],
      source: "istock",
    });
    await seedImage({
      source_ref: "s-source-miss",
      caption: "A tabby cat in a studio environment.",
      tags: ["cat", "studio"],
      source: "upload",
    });
    const res = await listImages({
      query: "tabby",
      tags: ["cat", "studio"],
      source: "istock",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([matchId]);
  });
});

// ---------------------------------------------------------------------------
// Pagination + ordering
// ---------------------------------------------------------------------------

describe("listImages — pagination + ordering", () => {
  it("orders by created_at desc (newest first)", async () => {
    const oldId = await seedImage({
      source_ref: "s-old",
      caption: "Old.",
      createdAtOffsetMs: -60_000,
    });
    const newId = await seedImage({
      source_ref: "s-new",
      caption: "New.",
      createdAtOffsetMs: -1_000,
    });
    const res = await listImages();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toEqual([newId, oldId]);
  });

  it("windows results by limit + offset and reports accurate total", async () => {
    // Seed 5 rows with ascending created_at so the natural order is
    // s-4, s-3, s-2, s-1, s-0 (newest first).
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedImage({
          source_ref: `s-${i}`,
          caption: `Image ${i}.`,
          createdAtOffsetMs: i * 1000,
        }),
      );
    }

    const page1 = await listImages({ limit: 2, offset: 0 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.data.items.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    expect(page1.data.total).toBe(5);
    expect(page1.data.limit).toBe(2);
    expect(page1.data.offset).toBe(0);

    const page2 = await listImages({ limit: 2, offset: 2 });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.data.items.map((i) => i.id)).toEqual([ids[2], ids[1]]);
    expect(page2.data.total).toBe(5);

    const page3 = await listImages({ limit: 2, offset: 4 });
    expect(page3.ok).toBe(true);
    if (!page3.ok) return;
    expect(page3.data.items.map((i) => i.id)).toEqual([ids[0]]);
  });

  it("clamps limit to LIST_IMAGES_MAX_LIMIT when too high", async () => {
    const res = await listImages({ limit: LIST_IMAGES_MAX_LIMIT + 500 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.limit).toBe(LIST_IMAGES_MAX_LIMIT);
  });

  it("clamps limit to 1 when zero or negative", async () => {
    const res = await listImages({ limit: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.limit).toBe(1);
  });

  it("clamps offset to 0 when negative", async () => {
    const res = await listImages({ offset: -10 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.offset).toBe(0);
  });

  it("defaults to LIST_IMAGES_DEFAULT_LIMIT when limit omitted", async () => {
    const res = await listImages();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.limit).toBe(LIST_IMAGES_DEFAULT_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

describe("listImages — row shape", () => {
  it("returns the fields the UI needs with null-safe defaults", async () => {
    const id = await seedImage({
      source_ref: "s-shape",
      filename: "shape.jpg",
      caption: "Shape test image.",
      alt_text: "Alt text.",
      tags: ["a", "b"],
      source: "istock",
    });
    const res = await listImages();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const item = res.data.items.find((i) => i.id === id);
    expect(item).toBeDefined();
    expect(item?.caption).toBe("Shape test image.");
    expect(item?.alt_text).toBe("Alt text.");
    expect(item?.tags).toEqual(["a", "b"]);
    expect(item?.source).toBe("istock");
    expect(item?.source_ref).toBe("s-shape");
    expect(item?.width_px).toBe(1024);
    expect(item?.height_px).toBe(768);
    expect(item?.deleted_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getImage — detail fetch with usage + metadata joins
// ---------------------------------------------------------------------------

async function seedSite(opts: { name: string; prefix: string; wp_url?: string }): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("sites")
    .insert({
      name: opts.name,
      prefix: opts.prefix,
      wp_url: opts.wp_url ?? `https://${opts.prefix}.example`,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedSite: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

async function seedUsage(opts: {
  image_id: string;
  site_id: string;
  state?: "pending_transfer" | "transferred" | "failed";
  wp_media_id?: number | null;
}): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("image_usage").insert({
    image_id: opts.image_id,
    site_id: opts.site_id,
    state: opts.state ?? "transferred",
    wp_media_id: opts.wp_media_id ?? 4242,
    wp_source_url: "https://example.test/wp-content/uploads/x.jpg",
    wp_idempotency_marker: `m-${opts.site_id}-${opts.image_id}`,
    transferred_at: new Date().toISOString(),
  });
  if (error) throw new Error(`seedUsage: ${error.message}`);
}

async function seedMetadata(opts: {
  image_id: string;
  key: string;
  value: unknown;
}): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("image_metadata").insert({
    image_id: opts.image_id,
    key: opts.key,
    value_jsonb: opts.value,
  });
  if (error) throw new Error(`seedMetadata: ${error.message}`);
}

describe("getImage — detail fetch", () => {
  it("returns NOT_FOUND for an unknown id", async () => {
    const res = await getImage("00000000-0000-0000-0000-000000000000");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("joins image_usage rows with site name + wp_url", async () => {
    const imageId = await seedImage({
      source_ref: "s-join",
      caption: "Join test image.",
      tags: ["join"],
    });
    const siteA = await seedSite({ name: "Site Alpha", prefix: "a1" });
    const siteB = await seedSite({ name: "Site Bravo", prefix: "b1" });
    await seedUsage({ image_id: imageId, site_id: siteA, wp_media_id: 101 });
    await seedUsage({
      image_id: imageId,
      site_id: siteB,
      wp_media_id: 202,
      state: "pending_transfer",
    });

    const res = await getImage(imageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usage).toHaveLength(2);
    const names = res.data.usage.map((u) => u.site_name).sort();
    expect(names).toEqual(["Site Alpha", "Site Bravo"]);
    const alphaRow = res.data.usage.find((u) => u.site_name === "Site Alpha");
    expect(alphaRow?.wp_media_id).toBe(101);
    expect(alphaRow?.state).toBe("transferred");
    expect(alphaRow?.wp_url).toBe("https://a1.example");
  });

  it("returns metadata rows sorted by key", async () => {
    const imageId = await seedImage({
      source_ref: "s-meta",
      caption: "Metadata test.",
    });
    await seedMetadata({ image_id: imageId, key: "zebra", value: "last" });
    await seedMetadata({
      image_id: imageId,
      key: "alpha",
      value: { nested: true },
    });

    const res = await getImage(imageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.metadata.map((m) => m.key)).toEqual(["alpha", "zebra"]);
    expect(res.data.metadata[0]?.value_jsonb).toEqual({ nested: true });
  });

  it("returns empty arrays when no usage / metadata rows exist", async () => {
    const imageId = await seedImage({
      source_ref: "s-lonely",
      caption: "Lonely image.",
    });
    const res = await getImage(imageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.usage).toEqual([]);
    expect(res.data.metadata).toEqual([]);
  });

  it("surfaces version_lock for optimistic-concurrency wiring (M5-3)", async () => {
    const imageId = await seedImage({
      source_ref: "s-version",
      caption: "Versioned image.",
    });
    const res = await getImage(imageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.image.version_lock).toBe(1);
  });

  it("still fetches soft-deleted images (admin surface)", async () => {
    const imageId = await seedImage({
      source_ref: "s-soft-del",
      caption: "Soft-deleted.",
      deleted: true,
    });
    const res = await getImage(imageId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.image.id).toBe(imageId);
    expect(res.data.image.deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateImageMetadata — optimistic-locked metadata edits (M5-3)
// ---------------------------------------------------------------------------

describe("updateImageMetadata — happy path", () => {
  it("updates caption + alt + tags and bumps version_lock", async () => {
    const id = await seedImage({
      source_ref: "s-upd-happy",
      caption: "Before.",
      alt_text: "Before alt.",
      tags: ["old"],
    });
    const res = await updateImageMetadata(id, {
      expected_version: 1,
      patch: {
        caption: "After.",
        alt_text: "After alt.",
        tags: ["new", "updated"],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.caption).toBe("After.");
    expect(res.data.alt_text).toBe("After alt.");
    expect(res.data.tags).toEqual(["new", "updated"]);
    expect(res.data.version_lock).toBe(2);
  });

  it("updates only the fields provided (partial patch)", async () => {
    const id = await seedImage({
      source_ref: "s-upd-partial",
      caption: "Keep caption.",
      alt_text: "Keep alt.",
      tags: ["keep"],
    });
    const res = await updateImageMetadata(id, {
      expected_version: 1,
      patch: { caption: "Only caption changed." },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.caption).toBe("Only caption changed.");
    expect(res.data.alt_text).toBe("Keep alt.");
    expect(res.data.tags).toEqual(["keep"]);
  });

  it("accepts explicit null to clear caption / alt_text", async () => {
    const id = await seedImage({
      source_ref: "s-upd-clear",
      caption: "Original caption.",
      alt_text: "Original alt.",
    });
    const res = await updateImageMetadata(id, {
      expected_version: 1,
      patch: { caption: null, alt_text: null },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.caption).toBeNull();
    expect(res.data.alt_text).toBeNull();
  });

  it("refreshes search_tsv via the M4-1 trigger after a caption change", async () => {
    const id = await seedImage({
      source_ref: "s-upd-tsv",
      caption: "Original caption words.",
      tags: ["foo"],
    });
    await updateImageMetadata(id, {
      expected_version: 1,
      patch: { caption: "Updated helicopter words." },
    });
    // The search_tsv trigger should have picked up the new caption.
    const res = await listImages({ query: "helicopter" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.items.map((i) => i.id)).toContain(id);
  });
});

describe("updateImageMetadata — error paths", () => {
  it("returns VERSION_CONFLICT when expected_version is stale", async () => {
    const id = await seedImage({
      source_ref: "s-upd-conflict",
      caption: "Before.",
    });
    // First edit succeeds, bumping version_lock to 2.
    await updateImageMetadata(id, {
      expected_version: 1,
      patch: { caption: "After round one." },
    });
    // Second edit with the stale version_lock=1 must fail.
    const res = await updateImageMetadata(id, {
      expected_version: 1,
      patch: { caption: "Trying to clobber round one." },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VERSION_CONFLICT");
    expect(res.error.details?.current_version).toBe(2);
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    const res = await updateImageMetadata(
      "00000000-0000-0000-0000-000000000000",
      { expected_version: 1, patch: { caption: "whatever" } },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("stamps updated_by when supplied", async () => {
    // Seed an opollo_users row so the FK resolves; the actual user
    // does not need an auth record for this test path.
    const svc = getServiceRoleClient();
    const userId = "11111111-2222-3333-4444-555555555555";
    const insertRes = await svc.from("opollo_users").insert({
      id: userId,
      email: "edit-attribution@opollo.test",
      role: "admin",
    });
    expect(insertRes.error).toBeNull();

    const id = await seedImage({
      source_ref: "s-upd-attribution",
      caption: "Attributable edit.",
    });
    const res = await updateImageMetadata(id, {
      expected_version: 1,
      updated_by: userId,
      patch: { caption: "Edited by a real operator." },
    });
    expect(res.ok).toBe(true);

    const readBack = await svc
      .from("image_library")
      .select("updated_by")
      .eq("id", id)
      .maybeSingle();
    expect(readBack.data?.updated_by).toBe(userId);
  });
});
