import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// B4 — resolve a draft's media for publishing.
//
// §1.6 of MASS_IMAGE_GEN_BUILD_BRIEF: signed URLs are produced at publish
// time, not stored. A draft can carry media in two shapes:
//
//   - `media_asset_ids` (uuid[])  : modern shape. Each id points at a row
//                                   in `social_media_assets` whose
//                                   `storage_path` we sign here.
//   - `media_urls`      (text[])  : legacy shape. Pre-existing drafts and
//                                   the CAP pipeline (until B4 is wired all
//                                   the way through) still write external
//                                   URLs directly.
//
// Resolution order: asset-derived signed URLs first, legacy media_urls
// appended. Duplicates removed. Both empty → empty array.
//
// Signing failures degrade gracefully: an asset that fails to sign is
// skipped (with a warn log), not raised. The publish will still proceed
// with whatever URLs did resolve plus any legacy media_urls.
// ---------------------------------------------------------------------------

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL_SECONDS = 3600;

export interface ResolveMediaInput {
  mediaAssetIds: string[] | null;
  legacyMediaUrls: string[] | null;
}

export async function resolveMediaForPublish(
  input: ResolveMediaInput,
): Promise<string[]> {
  const ids = (input.mediaAssetIds ?? []).filter(Boolean);
  const legacy = (input.legacyMediaUrls ?? []).filter(Boolean);

  if (ids.length === 0) {
    return dedupe(legacy);
  }

  const signed = await signFromAssetIds(ids);
  return dedupe([...signed, ...legacy]);
}

async function signFromAssetIds(assetIds: string[]): Promise<string[]> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc
    .from("social_media_assets")
    .select("id, storage_path")
    .in("id", assetIds);

  if (error) {
    logger.warn("publish.resolve_media.assets_query_failed", {
      assetIds,
      err: error.message,
    });
    return [];
  }

  if (!data || data.length === 0) {
    logger.warn("publish.resolve_media.assets_missing", { assetIds });
    return [];
  }

  // Preserve the order of asset_ids the draft carries. createSignedUrl
  // accepts a single path at a time; resolve sequentially to keep error
  // semantics simple — at small N (per-draft media count) this is fine.
  const byId = new Map<string, string>();
  for (const row of data as Array<{ id: string; storage_path: string }>) {
    byId.set(row.id, row.storage_path);
  }

  const urls: string[] = [];
  for (const id of assetIds) {
    const path = byId.get(id);
    if (!path) {
      logger.warn("publish.resolve_media.asset_not_found", { assetId: id });
      continue;
    }
    try {
      const { data: signed, error: signErr } = await svc.storage
        .from(IMAGE_GEN_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (signErr || !signed?.signedUrl) {
        logger.warn("publish.resolve_media.sign_failed", {
          assetId: id,
          path,
          err: signErr?.message,
        });
        continue;
      }
      urls.push(signed.signedUrl);
    } catch (err) {
      logger.warn("publish.resolve_media.sign_threw", {
        assetId: id,
        path,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return urls;
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
