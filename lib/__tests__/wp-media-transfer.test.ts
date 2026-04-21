import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  transferImagesForPage,
  type WpMediaCallBundle,
  type WpMediaUploadResult,
} from "@/lib/wp-media-transfer";
import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M4-7 — WP media transfer tests.
//
// DB-backed. Pins:
//
//   - Fresh (image, site) pair triggers fetch + upload, populates
//     image_usage with wp_media_id + wp_source_url, and returns the
//     mapping for the HTML rewriter.
//   - Subsequent calls for the same (image, site) reuse the row
//     without re-invoking WP.
//   - Concurrent-publisher race: two simultaneous transfers of the
//     same (image, site) result in exactly ONE WP upload, both
//     callers end up with the same wp_source_url (winner) or the
//     loser defers with WP_MEDIA_IN_FLIGHT (retryable).
//   - GET-by-marker adoption: when a WP-side record exists but the
//     DB never landed, transferImagesForPage adopts it without a
//     re-upload.
//   - Non-retryable WP failure (e.g. 413) marks image_usage failed
//     + returns non-retryable.
//   - Unknown cloudflare id (not in image_library) is listed in
//     unknownIds and doesn't trigger upload.
// ---------------------------------------------------------------------------

async function seedImageLibrary(cloudflareId: string): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_library")
    .insert({
      source: "istock",
      source_ref: `istock-${cloudflareId}`,
      filename: `${cloudflareId}.jpg`,
      cloudflare_id: cloudflareId,
      caption:
        "A placeholder caption just long enough to pass structural validation.",
      alt_text: "Placeholder",
      tags: ["test", "placeholder", "fixture"],
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedImageLibrary: ${error?.message}`);
  return data.id as string;
}

type UploadCall = { filename: string; marker: string };

function buildWpStub(opts: {
  uploads?: UploadCall[];
  uploadResult?: (req: {
    filename: string;
    idempotencyMarker: string;
  }) => WpMediaUploadResult;
  fetchImpl?: WpMediaCallBundle["fetchImage"];
  findByMarkerImpl?: WpMediaCallBundle["findByMarker"];
}): WpMediaCallBundle {
  return {
    fetchImage:
      opts.fetchImpl ??
      (async (_url) => ({
        bytes: new ArrayBuffer(16),
        mimeType: "image/jpeg",
        filename: "fixture.jpg",
      })),
    uploadMedia: async (req) => {
      if (opts.uploads)
        opts.uploads.push({
          filename: req.filename,
          marker: req.idempotencyMarker,
        });
      if (opts.uploadResult) return opts.uploadResult(req);
      return {
        ok: true,
        wp_media_id: 42,
        source_url: `https://client.example/wp-content/uploads/${req.idempotencyMarker}.jpg`,
      };
    },
    findByMarker: opts.findByMarkerImpl ?? (async () => null),
  };
}

// ---------------------------------------------------------------------------
// Fresh pair → single upload + populated row
// ---------------------------------------------------------------------------

describe("transferImagesForPage — fresh (image, site) pair", () => {
  it("uploads to WP and writes the image_usage row", async () => {
    const site = await seedSite();
    const imageId = await seedImageLibrary("cf-cat");

    const uploads: UploadCall[] = [];
    const result = await transferImagesForPage({
      cloudflareIds: new Set(["cf-cat"]),
      siteId: site.id,
      wpMedia: buildWpStub({ uploads }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapping.get("cf-cat")).toBe(
      "https://client.example/wp-content/uploads/opollo-img-" +
        imageId.replace(/-/g, "") +
        "-" +
        site.id.slice(0, 8) +
        ".jpg",
    );
    expect(uploads).toHaveLength(1);

    const svc = getServiceRoleClient();
    const { data: usage } = await svc
      .from("image_usage")
      .select("state, wp_media_id, wp_source_url, wp_idempotency_marker")
      .eq("image_id", imageId)
      .eq("site_id", site.id)
      .single();
    expect(usage?.state).toBe("transferred");
    expect(Number(usage?.wp_media_id)).toBe(42);
    expect(usage?.wp_source_url).toContain("opollo-img-");
  });
});

// ---------------------------------------------------------------------------
// Re-use on second call (idempotent)
// ---------------------------------------------------------------------------

describe("transferImagesForPage — re-use existing transferred row", () => {
  it("does not re-upload when image_usage.state='transferred'", async () => {
    const site = await seedSite();
    const imageId = await seedImageLibrary("cf-reuse");

    const uploads1: UploadCall[] = [];
    const first = await transferImagesForPage({
      cloudflareIds: new Set(["cf-reuse"]),
      siteId: site.id,
      wpMedia: buildWpStub({ uploads: uploads1 }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });
    expect(first.ok).toBe(true);
    expect(uploads1).toHaveLength(1);

    const uploads2: UploadCall[] = [];
    const second = await transferImagesForPage({
      cloudflareIds: new Set(["cf-reuse"]),
      siteId: site.id,
      wpMedia: buildWpStub({ uploads: uploads2 }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(uploads2).toHaveLength(0);
    expect(second.mapping.get("cf-reuse")).toContain("opollo-img-");

    // Exactly one image_usage row.
    const svc = getServiceRoleClient();
    const { count } = await svc
      .from("image_usage")
      .select("*", { count: "exact", head: true })
      .eq("image_id", imageId)
      .eq("site_id", site.id);
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent race: two publishes of same (image, site)
// ---------------------------------------------------------------------------

describe("transferImagesForPage — concurrent race", () => {
  it("two concurrent transfers observe exactly one WP upload; loser defers", async () => {
    const site = await seedSite();
    await seedImageLibrary("cf-race");

    // Gated upload: the first call blocks on a promise until we release
    // it. The second concurrent call hits the pending row and defers.
    let releaseUpload!: () => void;
    const uploadReleased = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    const uploads: UploadCall[] = [];
    const slowStub: WpMediaCallBundle = {
      fetchImage: async () => ({
        bytes: new ArrayBuffer(16),
        mimeType: "image/jpeg",
        filename: "race.jpg",
      }),
      uploadMedia: async (req) => {
        uploads.push({
          filename: req.filename,
          marker: req.idempotencyMarker,
        });
        await uploadReleased;
        return {
          ok: true,
          wp_media_id: 99,
          source_url: `https://client.example/wp-content/uploads/${req.idempotencyMarker}.jpg`,
        };
      },
      findByMarker: async () => null,
    };
    const fastStub: WpMediaCallBundle = {
      fetchImage: async () => ({
        bytes: new ArrayBuffer(16),
        mimeType: "image/jpeg",
        filename: "race.jpg",
      }),
      uploadMedia: async (req) => {
        uploads.push({
          filename: req.filename,
          marker: req.idempotencyMarker,
        });
        return {
          ok: true,
          wp_media_id: 100,
          source_url: `https://client.example/wp-content/uploads/${req.idempotencyMarker}.jpg`,
        };
      },
      findByMarker: async () => null,
    };

    // Worker A starts and blocks inside upload.
    const workerA = transferImagesForPage({
      cloudflareIds: new Set(["cf-race"]),
      siteId: site.id,
      wpMedia: slowStub,
      cloudflareUrlFor: (id) =>
        `https://imagedelivery.net/HASH/${id}/public`,
    });

    // Give workerA enough time to INSERT the image_usage row.
    await new Promise((r) => setTimeout(r, 50));

    // Worker B attempts while A's row is pending.
    const workerB = await transferImagesForPage({
      cloudflareIds: new Set(["cf-race"]),
      siteId: site.id,
      wpMedia: fastStub,
      cloudflareUrlFor: (id) =>
        `https://imagedelivery.net/HASH/${id}/public`,
    });

    // Release A so it finishes.
    releaseUpload();
    const aResult = await workerA;

    expect(aResult.ok).toBe(true);
    expect(workerB.ok).toBe(false);
    if (workerB.ok) return;
    expect(workerB.code).toBe("WP_MEDIA_IN_FLIGHT");
    expect(workerB.retryable).toBe(true);

    // Exactly ONE upload attempted (worker A); worker B deferred.
    expect(uploads).toHaveLength(1);

    const svc = getServiceRoleClient();
    const { data: usage } = await svc
      .from("image_usage")
      .select("wp_media_id")
      .eq("site_id", site.id)
      .single();
    expect(Number(usage?.wp_media_id)).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// GET-by-marker adoption (partial-commit safety net)
// ---------------------------------------------------------------------------

describe("transferImagesForPage — GET-by-marker adoption", () => {
  it("adopts an existing WP media record without re-uploading", async () => {
    const site = await seedSite();
    await seedImageLibrary("cf-adopt");

    const uploads: UploadCall[] = [];
    const result = await transferImagesForPage({
      cloudflareIds: new Set(["cf-adopt"]),
      siteId: site.id,
      wpMedia: buildWpStub({
        uploads,
        findByMarkerImpl: async (marker) => ({
          wp_media_id: 888,
          source_url: `https://client.example/wp-content/uploads/${marker}.jpg`,
        }),
      }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uploads).toHaveLength(0);
    expect(result.mapping.get("cf-adopt")).toContain("opollo-img-");

    const svc = getServiceRoleClient();
    const { data: usage } = await svc
      .from("image_usage")
      .select("state, wp_media_id")
      .eq("site_id", site.id)
      .single();
    expect(usage?.state).toBe("transferred");
    expect(Number(usage?.wp_media_id)).toBe(888);
  });
});

// ---------------------------------------------------------------------------
// Non-retryable WP failure
// ---------------------------------------------------------------------------

describe("transferImagesForPage — non-retryable failure", () => {
  it("marks image_usage failed + returns retryable=false on WP 413", async () => {
    const site = await seedSite();
    const imageId = await seedImageLibrary("cf-fail");

    const result = await transferImagesForPage({
      cloudflareIds: new Set(["cf-fail"]),
      siteId: site.id,
      wpMedia: buildWpStub({
        uploadResult: () => ({
          ok: false,
          code: "WP_PAYLOAD_TOO_LARGE",
          message: "413",
          retryable: false,
        }),
      }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WP_PAYLOAD_TOO_LARGE");
    expect(result.retryable).toBe(false);

    const svc = getServiceRoleClient();
    const { data: usage } = await svc
      .from("image_usage")
      .select("state, failure_code")
      .eq("image_id", imageId)
      .eq("site_id", site.id)
      .single();
    expect(usage?.state).toBe("failed");
    expect(usage?.failure_code).toBe("WP_PAYLOAD_TOO_LARGE");
  });
});

// ---------------------------------------------------------------------------
// Unknown cloudflare id
// ---------------------------------------------------------------------------

describe("transferImagesForPage — unknown id", () => {
  it("surfaces unknownIds without invoking upload", async () => {
    const site = await seedSite();

    const uploads: UploadCall[] = [];
    const result = await transferImagesForPage({
      cloudflareIds: new Set(["cf-not-in-library"]),
      siteId: site.id,
      wpMedia: buildWpStub({ uploads }),
      cloudflareUrlFor: (id) => `https://imagedelivery.net/HASH/${id}/public`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uploads).toHaveLength(0);
    expect(result.mapping.size).toBe(0);
    expect(result.unknownIds.has("cf-not-in-library")).toBe(true);
  });
});
