import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M5-1 — image library data layer (list surface).
//
// Read-only helpers that back `/admin/images`. Service-role client;
// the admin gate runs above the caller (Server Component + API route)
// so RLS bypass is appropriate here.
//
// listImages supports:
//   - Full-text search via image_library.search_tsv (GIN-indexed, already
//     maintained by the M4-1 trigger).
//   - Tag AND filter (tags @> $tags).
//   - Source filter (istock | upload | generated).
//   - deleted/active toggle — by default we filter `deleted_at IS NULL`
//     so soft-deleted rows stay hidden; passing `{ deleted: true }`
//     surfaces them (M5-4 will wire the UI toggle).
//   - Paged at caller-supplied `limit` + `offset` with a hard cap on
//     both so a bogus URL can't ask for 100k rows.
//
// The list page also needs a total count for pagination controls; we
// run a separate `count: 'exact', head: true` query alongside the data
// fetch. Both hit the same indexes; overhead is small for 9k rows and
// avoids pulling rows just to count them.
// ---------------------------------------------------------------------------

export const LIST_IMAGES_MAX_LIMIT = 100;
export const LIST_IMAGES_DEFAULT_LIMIT = 50;

export type ImageLibrarySource = "istock" | "upload" | "generated";

export type ListImagesParams = {
  query?: string;
  tags?: readonly string[];
  source?: ImageLibrarySource;
  deleted?: boolean;
  limit?: number;
  offset?: number;
};

export type ImageListItem = {
  id: string;
  cloudflare_id: string | null;
  filename: string | null;
  caption: string | null;
  alt_text: string | null;
  tags: string[];
  source: ImageLibrarySource;
  source_ref: string | null;
  width_px: number | null;
  height_px: number | null;
  bytes: number | null;
  deleted_at: string | null;
  created_at: string;
};

export type ListImagesResult = {
  items: ImageListItem[];
  total: number;
  limit: number;
  offset: number;
};

const LIGHT_IMAGE_FIELDS =
  "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at";

function now(): string {
  return new Date().toISOString();
}

function internalError(
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      details,
      retryable: false,
      suggested_action: "Check Supabase connectivity and server logs.",
    },
    timestamp: now(),
  };
}

function clampLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return LIST_IMAGES_DEFAULT_LIMIT;
  const rounded = Math.floor(raw);
  if (rounded < 1) return 1;
  if (rounded > LIST_IMAGES_MAX_LIMIT) return LIST_IMAGES_MAX_LIMIT;
  return rounded;
}

function clampOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  const rounded = Math.floor(raw);
  return rounded < 0 ? 0 : rounded;
}

function rowToItem(row: Record<string, unknown>): ImageListItem {
  const rawBytes = row.bytes;
  const bytes =
    typeof rawBytes === "number"
      ? rawBytes
      : typeof rawBytes === "string"
        ? Number(rawBytes)
        : null;
  return {
    id: row.id as string,
    cloudflare_id: (row.cloudflare_id as string | null) ?? null,
    filename: (row.filename as string | null) ?? null,
    caption: (row.caption as string | null) ?? null,
    alt_text: (row.alt_text as string | null) ?? null,
    tags: (row.tags as string[] | null) ?? [],
    source: row.source as ImageLibrarySource,
    source_ref: (row.source_ref as string | null) ?? null,
    width_px: (row.width_px as number | null) ?? null,
    height_px: (row.height_px as number | null) ?? null,
    bytes,
    deleted_at: (row.deleted_at as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

export async function listImages(
  params: ListImagesParams = {},
): Promise<ApiResponse<ListImagesResult>> {
  try {
    return await listImagesImpl(params);
  } catch (err) {
    return internalError(
      `Unhandled error in listImages: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function listImagesImpl(
  params: ListImagesParams,
): Promise<ApiResponse<ListImagesResult>> {
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const supabase = getServiceRoleClient();

  // Data fetch: paginated window ordered by created_at desc.
  let dataQuery = supabase
    .from("image_library")
    .select(LIGHT_IMAGE_FIELDS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (params.deleted) {
    dataQuery = dataQuery.not("deleted_at", "is", null);
  } else {
    dataQuery = dataQuery.is("deleted_at", null);
  }
  if (params.query && params.query.length > 0) {
    dataQuery = dataQuery.textSearch("search_tsv", params.query, {
      type: "plain",
      config: "english",
    });
  }
  if (params.tags && params.tags.length > 0) {
    dataQuery = dataQuery.contains("tags", params.tags as string[]);
  }
  if (params.source) {
    dataQuery = dataQuery.eq("source", params.source);
  }
  const dataRes = await dataQuery;
  if (dataRes.error) {
    return internalError("Failed to list images.", {
      supabase_error: dataRes.error,
    });
  }

  // Count fetch: HEAD request, returns count without row bodies. Same
  // filter set as the data query.
  let countQuery = supabase
    .from("image_library")
    .select("id", { count: "exact", head: true });
  if (params.deleted) {
    countQuery = countQuery.not("deleted_at", "is", null);
  } else {
    countQuery = countQuery.is("deleted_at", null);
  }
  if (params.query && params.query.length > 0) {
    countQuery = countQuery.textSearch("search_tsv", params.query, {
      type: "plain",
      config: "english",
    });
  }
  if (params.tags && params.tags.length > 0) {
    countQuery = countQuery.contains("tags", params.tags as string[]);
  }
  if (params.source) {
    countQuery = countQuery.eq("source", params.source);
  }
  const countRes = await countQuery;
  if (countRes.error) {
    return internalError("Failed to count images.", {
      supabase_error: countRes.error,
    });
  }

  const items = ((dataRes.data ?? []) as Record<string, unknown>[]).map(
    rowToItem,
  );
  const total = countRes.count ?? 0;

  return {
    ok: true,
    data: { items, total, limit, offset },
    timestamp: now(),
  };
}
