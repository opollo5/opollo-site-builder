import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-23 — list a company's social_media_assets, newest first.
//
// Capped at 200 V1 (single library page; pagination is a future
// concern when libraries get large). Returns the fields the picker
// + library page need.
// ---------------------------------------------------------------------------

export type MediaAsset = {
  id: string;
  source_url: string | null;
  storage_path: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  bundle_upload_id: string | null;
  created_at: string;
};

export async function listMediaAssets(args: {
  companyId: string;
}): Promise<ApiResponse<{ assets: MediaAsset[] }>> {
  if (!args.companyId) {
    return validation("companyId required.");
  }
  const svc = getServiceRoleClient();
  const result = await svc
    .from("social_media_assets")
    .select(
      "id, source_url, storage_path, mime_type, bytes, width, height, bundle_upload_id, created_at",
    )
    .eq("company_id", args.companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (result.error) {
    logger.error("social.media.list.failed", {
      err: result.error.message,
      company_id: args.companyId,
    });
    return internal(`Failed to read assets: ${result.error.message}`);
  }
  const assets: MediaAsset[] = (result.data ?? []).map((r) => ({
    id: r.id as string,
    source_url: (r.source_url as string | null) ?? null,
    storage_path: r.storage_path as string,
    mime_type: r.mime_type as string,
    bytes: Number(r.bytes ?? 0),
    width: (r.width as number | null) ?? null,
    height: (r.height as number | null) ?? null,
    bundle_upload_id: (r.bundle_upload_id as string | null) ?? null,
    created_at: r.created_at as string,
  }));
  return {
    ok: true,
    data: { assets },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<{ assets: MediaAsset[] }> {
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

function internal(message: string): ApiResponse<{ assets: MediaAsset[] }> {
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
