import { describe, expect, it } from "vitest";

import {
  LIST_IMAGES_DEFAULT_LIMIT,
  LIST_IMAGES_MAX_LIMIT,
  listImages,
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
