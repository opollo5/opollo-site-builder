import "server-only";

import {
  getBundlesocialClient,
  getBundlesocialTeamId,
} from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-22 — resolve a social_media_assets row to a bundle.social uploadId.
//
// First read the cached bundle_upload_id; if present, return it (no
// network). Otherwise:
//   1. If source_url is set, call uploadCreateFromUrl — bundle.social
//      pulls the bytes themselves. Cheapest path.
//   2. (Future) If only storage_path is set, download from Supabase
//      Storage → upload as Blob via uploadCreate. Skipped in V1; row
//      with neither column populated returns NO_SOURCE.
//
// On success, write bundle_upload_id + bundle_uploaded_at back so
// the next caller hits the cache. Concurrent resolvers race at the
// UPDATE — last writer wins, both end up with valid ids (bundle.
// social's upload ids are immutable per upload, so ALL ids returned
// for the same asset are valid; we just keep the latest).
//
// Cross-company: caller passes companyId; we filter the asset lookup
// by it so a stolen asset id from another company errors with
// NOT_FOUND envelope.
// ---------------------------------------------------------------------------

export type ResolveBundleUploadInput = {
  assetId: string;
  companyId: string;
};

export type ResolveBundleUploadResult = {
  bundleUploadId: string;
  cached: boolean;
};

export async function resolveBundleUploadId(
  input: ResolveBundleUploadInput,
): Promise<ApiResponse<ResolveBundleUploadResult>> {
  if (!input.assetId) return validation("assetId required.");
  if (!input.companyId) return validation("companyId required.");

  const svc = getServiceRoleClient();

  const asset = await svc
    .from("social_media_assets")
    .select(
      "id, company_id, source_url, storage_path, bundle_upload_id, mime_type",
    )
    .eq("id", input.assetId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (asset.error) {
    logger.error("social.media.resolve.read_failed", {
      err: asset.error.message,
      asset_id: input.assetId,
    });
    return internal(`Asset read failed: ${asset.error.message}`);
  }
  if (!asset.data) return notFound();

  // Cache hit — return immediately, no network.
  if (asset.data.bundle_upload_id) {
    return {
      ok: true,
      data: {
        bundleUploadId: asset.data.bundle_upload_id as string,
        cached: true,
      },
      timestamp: new Date().toISOString(),
    };
  }

  const client = getBundlesocialClient();
  const teamId = getBundlesocialTeamId();
  if (!client || !teamId) {
    return notConfigured(client ? "BUNDLE_SOCIAL_TEAMID" : "BUNDLE_SOCIAL_API");
  }

  const sourceUrl = asset.data.source_url as string | null;
  if (!sourceUrl) {
    // V1 only supports source_url. storage_path-only assets need a
    // future slice that signs a Supabase Storage URL or downloads +
    // re-uploads as a Blob.
    return validation(
      "Asset has no source_url; storage_path-only assets are not yet supported.",
    );
  }

  let uploadId: string;
  try {
    const response = (await client.upload.uploadCreateFromUrl({
      requestBody: { teamId, url: sourceUrl },
    })) as { id?: string };
    if (!response.id) {
      return internal("bundle.social uploadCreateFromUrl returned no id.");
    }
    uploadId = response.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.media.resolve.bundle_upload_failed", {
      err: message,
      asset_id: input.assetId,
    });
    return internal(`bundle.social uploadCreateFromUrl failed: ${message}`);
  }

  const update = await svc
    .from("social_media_assets")
    .update({
      bundle_upload_id: uploadId,
      bundle_uploaded_at: new Date().toISOString(),
    })
    .eq("id", input.assetId);
  if (update.error) {
    // Don't fail the call — the upload landed; we just couldn't cache
    // the id. The next call will re-upload. Log so we notice.
    logger.warn("social.media.resolve.cache_write_failed", {
      err: update.error.message,
      asset_id: input.assetId,
    });
  }

  return {
    ok: true,
    data: { bundleUploadId: uploadId, cached: false },
    timestamp: new Date().toISOString(),
  };
}

// Resolve many in sequence. We don't parallelise because bundle.social's
// uploadCreateFromUrl rate limits aren't pinned; better to be polite.
// The cache shortcut keeps repeat calls cheap.
export async function resolveBundleUploadIds(
  assetIds: string[],
  companyId: string,
): Promise<ApiResponse<{ uploadIds: string[]; cachedCount: number }>> {
  const uploadIds: string[] = [];
  let cachedCount = 0;
  for (const assetId of assetIds) {
    const result = await resolveBundleUploadId({ assetId, companyId });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        timestamp: new Date().toISOString(),
      };
    }
    uploadIds.push(result.data.bundleUploadId);
    if (result.data.cached) cachedCount += 1;
  }
  return {
    ok: true,
    data: { uploadIds, cachedCount },
    timestamp: new Date().toISOString(),
  };
}

function validation<T>(message: string): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notFound<T>(): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Asset not found in this company.",
      retryable: false,
      suggested_action: "Check the asset id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notConfigured<T>(envVar: string): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `${envVar} not configured.`,
      retryable: false,
      suggested_action: "Provision the env var.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal<T>(message: string): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: true,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
