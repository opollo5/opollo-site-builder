import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-23 — create a social_media_assets row from a public URL.
//
// V1 input is just the URL + mime type + size hint. Future slices can
// add a multipart upload that lands in Supabase Storage and populates
// storage_path; the resolveBundleUploadId resolver supports both.
//
// We do a HEAD probe of the URL to confirm reachability and capture
// the actual content-length / content-type if the operator didn't
// pass them (best-effort; failure doesn't block creation since the
// asset may live behind auth that responds 401 to HEAD but 200 to a
// signed GET).
//
// storage_path is required by the schema; for URL-only assets we
// store the URL there too as a stable per-row identifier so future
// migrations don't have to handle nulls.
//
// Caller is responsible for canDo("edit_post") — assets are scoped to
// the company; only members can create.
// ---------------------------------------------------------------------------

export type CreateMediaAssetInput = {
  companyId: string;
  sourceUrl: string;
  mimeType?: string;
  bytes?: number;
  uploadedBy?: string | null;
};

export type CreateMediaAssetResult = {
  id: string;
  source_url: string;
  mime_type: string;
  bytes: number;
};

const URL_RE = /^https:\/\/[^\s]+$/;

export async function createMediaAsset(
  input: CreateMediaAssetInput,
): Promise<ApiResponse<CreateMediaAssetResult>> {
  if (!input.companyId) return validation("companyId required.");
  if (!input.sourceUrl) return validation("sourceUrl required.");
  if (!URL_RE.test(input.sourceUrl)) {
    return validation("sourceUrl must be an https URL.");
  }

  // Best-effort HEAD probe. Fall through to the operator-supplied
  // metadata when the server doesn't allow HEAD.
  let probedMime = input.mimeType ?? "application/octet-stream";
  let probedBytes = input.bytes ?? 0;
  try {
    const head = await fetch(input.sourceUrl, { method: "HEAD" });
    if (head.ok) {
      const ct = head.headers.get("content-type");
      if (ct && !input.mimeType) probedMime = ct.split(";")[0]!.trim();
      const cl = head.headers.get("content-length");
      if (cl && !input.bytes) {
        const n = Number.parseInt(cl, 10);
        if (Number.isFinite(n) && n > 0) probedBytes = n;
      }
    }
  } catch (err) {
    // Network failure or invalid URL — log + continue with defaults.
    logger.info("social.media.create.head_probe_failed", {
      err: err instanceof Error ? err.message : String(err),
      source_url: input.sourceUrl,
    });
  }

  const svc = getServiceRoleClient();
  const insert = await svc
    .from("social_media_assets")
    .insert({
      company_id: input.companyId,
      storage_path: input.sourceUrl,
      mime_type: probedMime,
      bytes: probedBytes,
      source_url: input.sourceUrl,
      uploaded_by: input.uploadedBy ?? null,
    })
    .select("id, source_url, mime_type, bytes")
    .single();
  if (insert.error) {
    logger.error("social.media.create.insert_failed", {
      err: insert.error.message,
      code: insert.error.code,
    });
    return internal(`Failed to create asset: ${insert.error.message}`);
  }

  return {
    ok: true,
    data: {
      id: insert.data.id as string,
      source_url: insert.data.source_url as string,
      mime_type: insert.data.mime_type as string,
      bytes: Number(insert.data.bytes ?? 0),
    },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<CreateMediaAssetResult> {
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

function internal(message: string): ApiResponse<CreateMediaAssetResult> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
