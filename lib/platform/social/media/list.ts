import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-23 — list a company's social_media_assets, newest first.
// S1-57 — cursor pagination via created_at; default 50 rows, max 100.
//          Caller passes `before` (created_at ISO of last asset seen) to
//          fetch the next page.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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
  before?: string;
  limit?: number;
}): Promise<ApiResponse<{ assets: MediaAsset[]; nextCursor: string | null }>> {
  if (!args.companyId) {
    return validation("companyId required.");
  }
  const pageSize = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const svc = getServiceRoleClient();
  const base = svc
    .from("social_media_assets")
    .select(
      "id, source_url, storage_path, mime_type, bytes, width, height, bundle_upload_id, created_at",
    )
    .eq("company_id", args.companyId)
    .order("created_at", { ascending: false })
    .limit(pageSize + 1);
  const result = await (args.before ? base.lt("created_at", args.before) : base);
  if (result.error) {
    logger.error("social.media.list.failed", {
      err: result.error.message,
      company_id: args.companyId,
    });
    return internal(`Failed to read assets: ${result.error.message}`);
  }
  const rows = result.data ?? [];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const assets: MediaAsset[] = page.map((r) => ({
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
  const nextCursor = hasMore ? (page[page.length - 1].created_at as string) : null;
  return {
    ok: true,
    data: { assets, nextCursor },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<{ assets: MediaAsset[]; nextCursor: string | null }> {
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

function internal(message: string): ApiResponse<{ assets: MediaAsset[]; nextCursor: string | null }> {
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
