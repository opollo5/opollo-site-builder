import { describe, expect, it } from "vitest";

import { executeSearchImages } from "@/lib/search-images";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  SEARCH_IMAGES_DEFAULT_LIMIT,
  SEARCH_IMAGES_MAX_LIMIT,
  searchImagesJsonSchema,
} from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M4-6 — search_images tool tests.
//
// Pins the invariants the chat model will rely on:
//
//   1. FTS matches against caption text. Query "cat" finds the cat
//      image but not the river one.
//
//   2. Tag AND filter — multiple tags require all to be present.
//
//   3. Soft-deleted rows never leak. Setting deleted_at excludes the
//      image even if the FTS query would otherwise match.
//
//   4. Limit capped at SEARCH_IMAGES_MAX_LIMIT; default applied when
//      omitted.
//
//   5. Input validation: at least one of {query, tags} required;
//      bogus inputs fail with VALIDATION_FAILED.
//
//   6. Images without captions are still returnable via tag filter
//      (caption = null passes through, tags match).
// ---------------------------------------------------------------------------

type ImageSeed = {
  filename: string;
  caption: string | null;
  alt_text: string | null;
  tags: string[];
  source_ref: string;
};

async function seedImage(seed: ImageSeed): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_library")
    .insert({
      source: "istock",
      source_ref: seed.source_ref,
      filename: seed.filename,
      caption: seed.caption,
      alt_text: seed.alt_text,
      tags: seed.tags,
      width_px: 1024,
      height_px: 768,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedImage: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

// ---------------------------------------------------------------------------
// FTS relevance
// ---------------------------------------------------------------------------

describe("executeSearchImages — FTS caption match", () => {
  it("returns images whose caption matches the query", async () => {
    const catId = await seedImage({
      source_ref: "s-cat",
      filename: "cat.jpg",
      caption: "A tabby cat sitting on a windowsill in morning light.",
      alt_text: "Cat on a windowsill.",
      tags: ["cat", "animal", "indoor"],
    });
    await seedImage({
      source_ref: "s-river",
      filename: "river.jpg",
      caption: "A wide river cutting through a forest valley at dusk.",
      alt_text: "River at dusk.",
      tags: ["river", "landscape", "nature"],
    });

    const res = await executeSearchImages({ query: "cat" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.images.map((i) => i.id)).toContain(catId);
    expect(res.data.images).toHaveLength(1);
    expect(res.data.images[0]?.caption).toContain("cat");
  });

  it("returns empty when nothing matches the query", async () => {
    await seedImage({
      source_ref: "s-river-2",
      filename: "river.jpg",
      caption: "A wide river cutting through a forest valley at dusk.",
      alt_text: "River at dusk.",
      tags: ["river", "landscape"],
    });
    const res = await executeSearchImages({ query: "helicopter" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.images).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tag AND filter
// ---------------------------------------------------------------------------

describe("executeSearchImages — tag filter", () => {
  it("returns images whose tags contain every supplied tag (AND)", async () => {
    const indoorCatId = await seedImage({
      source_ref: "s-cat-indoor",
      filename: "cat.jpg",
      caption: "A tabby cat sitting on a windowsill in morning light.",
      alt_text: "Cat on windowsill.",
      tags: ["cat", "animal", "indoor"],
    });
    await seedImage({
      source_ref: "s-cat-outdoor",
      filename: "cat-outside.jpg",
      caption: "A ginger cat walking across a garden path at sunset time.",
      alt_text: "Cat outdoors.",
      tags: ["cat", "animal", "outdoor"],
    });

    const res = await executeSearchImages({ tags: ["cat", "indoor"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.images.map((i) => i.id);
    expect(ids).toEqual([indoorCatId]);
  });

  it("returns images without captions when matched by tags alone", async () => {
    const pendingId = await seedImage({
      source_ref: "s-pending",
      filename: "pending.jpg",
      caption: null,
      alt_text: null,
      tags: ["cat", "animal", "pre-caption"],
    });

    const res = await executeSearchImages({ tags: ["pre-caption"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const found = res.data.images.find((i) => i.id === pendingId);
    expect(found).toBeDefined();
    expect(found?.caption).toBeNull();
    expect(found?.alt_text).toBeNull();
    expect(found?.tags).toEqual(["cat", "animal", "pre-caption"]);
  });
});

// ---------------------------------------------------------------------------
// Query + tags combined
// ---------------------------------------------------------------------------

describe("executeSearchImages — query + tags combined", () => {
  it("applies both filters (AND)", async () => {
    const matchId = await seedImage({
      source_ref: "s-combo-match",
      filename: "cat-indoor.jpg",
      caption: "Indoor studio shot of a tabby cat against soft afternoon light.",
      alt_text: "Indoor cat studio shot.",
      tags: ["cat", "indoor"],
    });
    await seedImage({
      source_ref: "s-combo-query-only",
      filename: "cat-outdoor.jpg",
      caption: "A tabby cat sitting in a field of tall wildflowers at dusk.",
      alt_text: "Outdoor cat shot.",
      tags: ["cat", "outdoor"],
    });
    await seedImage({
      source_ref: "s-combo-tag-only",
      filename: "indoor-room.jpg",
      caption: "A tidy living room with bookshelves and soft afternoon light.",
      alt_text: "Living room.",
      tags: ["indoor", "room", "interior"],
    });

    const res = await executeSearchImages({
      query: "tabby cat",
      tags: ["indoor"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.data.images.map((i) => i.id);
    expect(ids).toEqual([matchId]);
  });
});

// ---------------------------------------------------------------------------
// Soft-delete exclusion
// ---------------------------------------------------------------------------

describe("executeSearchImages — soft-delete exclusion", () => {
  it("never returns a row with deleted_at set", async () => {
    const id = await seedImage({
      source_ref: "s-del",
      filename: "cat.jpg",
      caption: "A soft studio photograph of a tabby cat near a window.",
      alt_text: "Tabby cat by window.",
      tags: ["cat", "animal", "indoor"],
    });

    const svc = getServiceRoleClient();
    await svc
      .from("image_library")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    const res = await executeSearchImages({ query: "cat" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.images.map((i) => i.id)).not.toContain(id);
  });
});

// ---------------------------------------------------------------------------
// Limit + default
// ---------------------------------------------------------------------------

describe("executeSearchImages — limit handling", () => {
  it("defaults to SEARCH_IMAGES_DEFAULT_LIMIT when limit omitted", async () => {
    // Seed more rows than the default so we can observe the cap in effect.
    for (let i = 0; i < SEARCH_IMAGES_DEFAULT_LIMIT + 5; i++) {
      await seedImage({
        source_ref: `s-bulk-${i}`,
        filename: `bulk-${i}.jpg`,
        caption: `A placeholder studio photograph number ${i} of a tabby cat.`,
        alt_text: `Bulk photo ${i}.`,
        tags: ["cat", "bulk"],
      });
    }

    const res = await executeSearchImages({ query: "tabby" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.images).toHaveLength(SEARCH_IMAGES_DEFAULT_LIMIT);
  });

  it("honours a caller-supplied limit", async () => {
    for (let i = 0; i < 8; i++) {
      await seedImage({
        source_ref: `s-small-${i}`,
        filename: `small-${i}.jpg`,
        caption: `A photograph labelled small placeholder number ${i} of a cat.`,
        alt_text: `Small photo ${i}.`,
        tags: ["cat", "small"],
      });
    }

    const res = await executeSearchImages({ query: "placeholder", limit: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.images).toHaveLength(3);
  });

  it("rejects limit above the cap", async () => {
    const res = await executeSearchImages({
      query: "cat",
      limit: SEARCH_IMAGES_MAX_LIMIT + 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("executeSearchImages — validation", () => {
  it("rejects an empty body (neither query nor tags)", async () => {
    const res = await executeSearchImages({});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
    expect(res.error.retryable).toBe(true);
  });

  it("rejects a null body", async () => {
    const res = await executeSearchImages(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects tags: [] (empty array)", async () => {
    const res = await executeSearchImages({ tags: [] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a query longer than 200 chars", async () => {
    const res = await executeSearchImages({ query: "a".repeat(201) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Schema registration (chat wiring sanity)
// ---------------------------------------------------------------------------

describe("searchImagesJsonSchema", () => {
  it("advertises the correct tool name + required shape for Anthropic tools", () => {
    expect(searchImagesJsonSchema.name).toBe("search_images");
    expect(searchImagesJsonSchema.input_schema.type).toBe("object");
    expect(searchImagesJsonSchema.input_schema.required).toEqual([]);
    expect(searchImagesJsonSchema.input_schema.properties).toHaveProperty("query");
    expect(searchImagesJsonSchema.input_schema.properties).toHaveProperty("tags");
    expect(searchImagesJsonSchema.input_schema.properties).toHaveProperty("limit");
  });
});
