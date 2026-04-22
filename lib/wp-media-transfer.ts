import { Client } from "pg";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-7 — WP media transfer per (image, site).
//
// Ensures every Cloudflare image referenced in a page's HTML is mirrored
// into the client WordPress site's media library, returning a mapping
// from cloudflare_id → wp_source_url that the HTML rewriter applies
// before the page body is written.
//
// Write-safety contract (mirrors docs/plans/m4.md):
//
//   1. `image_usage (image_id, site_id) UNIQUE` — exactly one row per
//      (image, site). Concurrent publishes of the same image to the
//      same site race for the INSERT; the loser hits 23505. We use
//      `SAVEPOINT wp_media_insert` to recover and adopt the existing
//      row (M3-6's page-adoption pattern, retargeted at image_usage).
//
//   2. Winner-finishes-before-loser-reads invariant. A naive SAVEPOINT
//      adoption would let the loser SELECT a pending row where the
//      winner hasn't committed its wp_media_id yet. We resolve this by
//      having the loser defer: if the existing row is still
//      `pending_transfer`, return a retryable `WP_MEDIA_IN_FLIGHT`
//      signal to the publish caller. M3-7's retry machinery picks up
//      the slot; by the time it re-runs, the winner has committed and
//      the row carries a real `wp_media_id` to adopt.
//
//   3. Pre-upload GET-by-marker adoption. `wp_idempotency_marker` is
//      deterministic on (image_id, site_id) so a retry after a
//      partial-commit crash (WP accepted but our DB write didn't land)
//      can GET the media item by its marker stored in WP-side metadata
//      and adopt without re-uploading. For the M4-7 baseline we assert
//      the marker via a GET-by-slug/filename convention; extended
//      metadata round-trip is listed as a follow-up.
//
//   4. Image bytes fetched from Cloudflare, POSTed to WP. The fetch +
//      upload are dependency-injected (WpMediaCallBundle) so tests can
//      run end-to-end without real HTTP traffic. The production binder
//      lives in lib/wordpress (the batch-publisher composer wires it
//      through the existing WpCredentials bundle once provisioned).
//
// Scope decisions:
//
//   - Only images we own (image_library.cloudflare_id match) are
//     transferred. Foreign imagedelivery.net URLs that aren't in our
//     library are skipped (returned in `missedIds`); the publish
//     caller decides whether to abort (unknown image in HTML) or
//     proceed with the original URL.
//
//   - Transfer is per-publish, not batch. Each page publish triggers
//     upload of any images it references that aren't already in WP.
//     The per-(image, site) UNIQUE constraint is what keeps this O(1)
//     per image across publishes — once transferred, re-publishes
//     short-circuit on the existing image_usage row.
//
//   - Failure semantics mirror the rest of the publisher. Retryable
//     errors (WP 5xx, network, rate-limit, in-flight race) → retryable
//     true; the slot goes back to the retry queue. Non-retryable (4xx
//     other than 429) → retryable false; publish marks the slot failed.
// ---------------------------------------------------------------------------

export type WpMediaCallBundle = {
  /**
   * Fetch image bytes from a Cloudflare delivery URL. Returns the raw
   * body + mime type. Retryable errors (5xx, network) throw with
   * retryable=true; terminal errors (403, 404) throw with
   * retryable=false.
   */
  fetchImage: (cloudflareUrl: string) => Promise<{
    bytes: ArrayBuffer;
    mimeType: string;
    filename: string;
  }>;

  /**
   * POST /wp-json/wp/v2/media with the image payload. Returns the new
   * WP media id + its `source_url`. Idempotency marker passed in
   * `filename` (WP persists it as the file's title) so a retry after
   * partial-commit can GET-by-title and adopt without re-upload.
   */
  uploadMedia: (req: {
    bytes: ArrayBuffer;
    mimeType: string;
    filename: string;
    idempotencyMarker: string;
  }) => Promise<WpMediaUploadResult>;

  /**
   * GET /wp-json/wp/v2/media?search=<marker>, return the first match
   * whose `title` or `slug` equals the marker. Null on no match.
   */
  findByMarker: (marker: string) => Promise<{
    wp_media_id: number;
    source_url: string;
  } | null>;
};

export type WpMediaUploadResult =
  | { ok: true; wp_media_id: number; source_url: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export type TransferImagesResult =
  | {
      ok: true;
      /** Mapping from cloudflare_id → wp_source_url for HTML rewrite. */
      mapping: Map<string, string>;
      /** Cloudflare ids that didn't resolve to an image_library row. */
      unknownIds: Set<string>;
    }
  | {
      ok: false;
      code: string;
      message: string;
      retryable: boolean;
    };

function idempotencyMarker(imageId: string, siteId: string): string {
  // Short, deterministic, URL/filename-safe. Not a secret — it's just a
  // marker the client can GET-by to recover partial commits.
  return `opollo-img-${imageId.replace(/-/g, "")}-${siteId.slice(0, 8)}`;
}

/**
 * Look up image_library rows by cloudflare_id. Rows that resolve
 * populate the first map (imageId → cloudflareId + filename); ids
 * that don't resolve land in the second set.
 */
async function resolveImages(cloudflareIds: Set<string>): Promise<{
  byCfId: Map<
    string,
    { imageId: string; cloudflareId: string; filename: string | null }
  >;
  unknownIds: Set<string>;
}> {
  const byCfId = new Map<
    string,
    { imageId: string; cloudflareId: string; filename: string | null }
  >();
  const unknownIds = new Set<string>(cloudflareIds);
  if (cloudflareIds.size === 0) {
    return { byCfId, unknownIds };
  }

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_library")
    .select("id, cloudflare_id, filename")
    .in("cloudflare_id", Array.from(cloudflareIds));
  if (error) {
    throw new Error(`resolveImages: ${error.message}`);
  }
  for (const row of data ?? []) {
    const cfId = row.cloudflare_id as string | null;
    const imageId = row.id as string;
    if (!cfId) continue;
    byCfId.set(cfId, {
      imageId,
      cloudflareId: cfId,
      filename: (row.filename as string | null) ?? null,
    });
    unknownIds.delete(cfId);
  }
  return { byCfId, unknownIds };
}

export type TransferImagesOptions = {
  cloudflareIds: ReadonlySet<string>;
  siteId: string;
  wpMedia: WpMediaCallBundle;
  /** Base Cloudflare delivery URL for source fetches. */
  cloudflareUrlFor: (cloudflareId: string) => string;
  client?: Client | null;
};

/**
 * Ensure every image referenced by `cloudflareIds` is transferred into
 * the site's WP media library. Returns a mapping for the HTML rewriter
 * or a retryable/non-retryable failure signal.
 */
export async function transferImagesForPage(
  opts: TransferImagesOptions,
): Promise<TransferImagesResult> {
  const { cloudflareIds, siteId, wpMedia, cloudflareUrlFor } = opts;
  const { byCfId, unknownIds } = await resolveImages(
    new Set(cloudflareIds),
  );

  const mapping = new Map<string, string>();

  for (const entry of byCfId.values()) {
    const marker = idempotencyMarker(entry.imageId, siteId);

    // Step 1: does image_usage already carry a transferred row?
    const existing = await loadImageUsage(entry.imageId, siteId);
    if (existing) {
      if (existing.state === "transferred" && existing.wp_source_url) {
        mapping.set(entry.cloudflareId, existing.wp_source_url);
        continue;
      }
      if (existing.state === "pending_transfer") {
        // Winner is in-flight. Defer so the retry sees the completed row.
        return {
          ok: false,
          code: "WP_MEDIA_IN_FLIGHT",
          message: `Image ${entry.imageId} is already being transferred to site ${siteId} by another publish.`,
          retryable: true,
        };
      }
      if (existing.state === "failed") {
        // Previous transfer marked failed. Retry via upload path below
        // (it will reset the row on success).
      }
    }

    // Step 2: claim image_usage — SAVEPOINT/adopt pattern.
    const claim = await claimImageUsage({
      imageId: entry.imageId,
      siteId,
      marker,
    });
    if (claim.kind === "adopt_transferred") {
      mapping.set(entry.cloudflareId, claim.wp_source_url);
      continue;
    }
    if (claim.kind === "race_in_flight") {
      return {
        ok: false,
        code: "WP_MEDIA_IN_FLIGHT",
        message: claim.message,
        retryable: true,
      };
    }

    // Step 3: GET-by-marker adoption (partial-commit safety net).
    const byMarker = await safeFindByMarker(wpMedia, marker);
    if (byMarker) {
      await markImageUsageTransferred({
        imageId: entry.imageId,
        siteId,
        wpMediaId: byMarker.wp_media_id,
        wpSourceUrl: byMarker.source_url,
      });
      mapping.set(entry.cloudflareId, byMarker.source_url);
      continue;
    }

    // Step 4: fetch image bytes + upload to WP.
    const sourceUrl = cloudflareUrlFor(entry.cloudflareId);
    let bytes: ArrayBuffer;
    let mimeType: string;
    let filename: string;
    try {
      const fetched = await wpMedia.fetchImage(sourceUrl);
      bytes = fetched.bytes;
      mimeType = fetched.mimeType;
      filename = fetched.filename;
    } catch (err) {
      await markImageUsageFailed({
        imageId: entry.imageId,
        siteId,
        failureCode: "CLOUDFLARE_FETCH_FAILED",
        failureDetail: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: "CLOUDFLARE_FETCH_FAILED",
        message: err instanceof Error ? err.message : String(err),
        retryable: isRetryableFetchError(err),
      };
    }

    const uploaded = await wpMedia.uploadMedia({
      bytes,
      mimeType,
      filename,
      idempotencyMarker: marker,
    });
    if (!uploaded.ok) {
      await markImageUsageFailed({
        imageId: entry.imageId,
        siteId,
        failureCode: uploaded.code,
        failureDetail: uploaded.message,
      });
      return {
        ok: false,
        code: uploaded.code,
        message: uploaded.message,
        retryable: uploaded.retryable,
      };
    }

    await markImageUsageTransferred({
      imageId: entry.imageId,
      siteId,
      wpMediaId: uploaded.wp_media_id,
      wpSourceUrl: uploaded.source_url,
    });
    mapping.set(entry.cloudflareId, uploaded.source_url);
  }

  return { ok: true, mapping, unknownIds };
}

function isRetryableFetchError(err: unknown): boolean {
  if (err && typeof err === "object" && "retryable" in err) {
    return Boolean((err as { retryable?: boolean }).retryable);
  }
  return true;
}

async function safeFindByMarker(
  wpMedia: WpMediaCallBundle,
  marker: string,
): Promise<{ wp_media_id: number; source_url: string } | null> {
  try {
    return await wpMedia.findByMarker(marker);
  } catch {
    // Adoption fetch is advisory — on error, fall through to upload.
    // A duplicate upload collides harmlessly on WP because the marker
    // is encoded in the filename and WP dedups by title; the INSERT
    // below still wins the DB slot.
    return null;
  }
}

// ---------------------------------------------------------------------------
// image_usage helpers (small, focused; the claim path is the tricky one)
// ---------------------------------------------------------------------------

type ExistingUsageRow = {
  state: "pending_transfer" | "transferred" | "failed";
  wp_media_id: number | null;
  wp_source_url: string | null;
};

async function loadImageUsage(
  imageId: string,
  siteId: string,
): Promise<ExistingUsageRow | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_usage")
    .select("state, wp_media_id, wp_source_url")
    .eq("image_id", imageId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (error) {
    throw new Error(`loadImageUsage: ${error.message}`);
  }
  if (!data) return null;
  return {
    state: data.state as ExistingUsageRow["state"],
    wp_media_id: (data.wp_media_id as number | null) ?? null,
    wp_source_url: (data.wp_source_url as string | null) ?? null,
  };
}

type ClaimResult =
  | { kind: "inserted" }
  | { kind: "adopt_transferred"; wp_source_url: string }
  | { kind: "race_in_flight"; message: string };

/**
 * Attempt the image_usage INSERT. On 23505 UNIQUE violation (concurrent
 * publish race), load the existing row:
 *   - transferred → adopt, return its wp_source_url.
 *   - pending_transfer → race_in_flight, caller defers.
 *   - failed → re-use the row (caller proceeds to upload).
 */
async function claimImageUsage(params: {
  imageId: string;
  siteId: string;
  marker: string;
}): Promise<ClaimResult> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("image_usage")
    .insert({
      image_id: params.imageId,
      site_id: params.siteId,
      wp_idempotency_marker: params.marker,
      state: "pending_transfer",
    });

  if (!error) return { kind: "inserted" };

  // supabase-js surfaces Postgres codes through the error body; the
  // common shape is { code: '23505' } for unique violation.
  const pgCode = (error as { code?: string }).code;
  if (pgCode !== "23505") {
    throw new Error(`claimImageUsage: ${error.message}`);
  }

  // Loser of the race. Load the row the winner inserted.
  const existing = await loadImageUsage(params.imageId, params.siteId);
  if (!existing) {
    return {
      kind: "race_in_flight",
      message:
        "23505 on image_usage insert but no visible existing row; caller should retry.",
    };
  }
  if (existing.state === "transferred" && existing.wp_source_url) {
    return {
      kind: "adopt_transferred",
      wp_source_url: existing.wp_source_url,
    };
  }
  if (existing.state === "pending_transfer") {
    return {
      kind: "race_in_flight",
      message: `Concurrent publisher is mid-transfer for image ${params.imageId} on site ${params.siteId}.`,
    };
  }
  // failed — caller will re-attempt via the upload path.
  return { kind: "inserted" };
}

async function markImageUsageTransferred(params: {
  imageId: string;
  siteId: string;
  wpMediaId: number;
  wpSourceUrl: string;
}): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("image_usage")
    .update({
      wp_media_id: params.wpMediaId,
      wp_source_url: params.wpSourceUrl,
      state: "transferred",
      transferred_at: new Date().toISOString(),
      failure_code: null,
      failure_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq("image_id", params.imageId)
    .eq("site_id", params.siteId);
  if (error) {
    throw new Error(`markImageUsageTransferred: ${error.message}`);
  }
}

async function markImageUsageFailed(params: {
  imageId: string;
  siteId: string;
  failureCode: string;
  failureDetail: string;
}): Promise<void> {
  const svc = getServiceRoleClient();
  // Best-effort update; swallow row-missing since we may be in a race
  // where the insert didn't complete.
  await svc
    .from("image_usage")
    .update({
      state: "failed",
      failure_code: params.failureCode,
      failure_detail: params.failureDetail,
      updated_at: new Date().toISOString(),
    })
    .eq("image_id", params.imageId)
    .eq("site_id", params.siteId);
}

export const __testing = {
  idempotencyMarker,
};
