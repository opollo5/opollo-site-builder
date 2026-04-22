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

export type ImageUsageSiteRow = {
  id: string;
  site_id: string;
  site_name: string;
  wp_url: string;
  wp_media_id: number | null;
  wp_source_url: string | null;
  state: "pending_transfer" | "transferred" | "failed";
  transferred_at: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
};

export type ImageMetadataRow = {
  key: string;
  value_jsonb: unknown;
  created_at: string;
  updated_at: string;
};

export type ImageDetail = {
  image: ImageListItem & { version_lock: number };
  usage: ImageUsageSiteRow[];
  metadata: ImageMetadataRow[];
};

const DETAIL_IMAGE_FIELDS =
  "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at, version_lock";

export async function getImage(
  id: string,
): Promise<ApiResponse<ImageDetail>> {
  try {
    return await getImageImpl(id);
  } catch (err) {
    return internalError(
      `Unhandled error in getImage: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function getImageImpl(
  id: string,
): Promise<ApiResponse<ImageDetail>> {
  const supabase = getServiceRoleClient();

  const imageRes = await supabase
    .from("image_library")
    .select(DETAIL_IMAGE_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (imageRes.error) {
    return internalError("Failed to fetch image.", {
      supabase_error: imageRes.error,
    });
  }
  if (!imageRes.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No image found with id ${id}.`,
        details: { id },
        retryable: false,
        suggested_action:
          "Verify the image id. Soft-deleted images are still fetchable; hard-removed ids are not.",
      },
      timestamp: now(),
    };
  }

  const row = imageRes.data as Record<string, unknown>;
  const base = rowToItem(row);
  const image = {
    ...base,
    version_lock: typeof row.version_lock === "number" ? row.version_lock : 1,
  };

  // Usage rows joined to sites so the UI can render the site name
  // rather than a bare UUID. Service-role query; RLS is not a factor
  // here since admin-gate has already authorised the caller.
  const usageRes = await supabase
    .from("image_usage")
    .select(
      "id, site_id, wp_media_id, wp_source_url, state, transferred_at, failure_code, failure_detail, created_at, site:sites!inner(name, wp_url)",
    )
    .eq("image_id", id)
    .order("created_at", { ascending: false });

  if (usageRes.error) {
    return internalError("Failed to fetch image_usage.", {
      supabase_error: usageRes.error,
    });
  }

  const usage: ImageUsageSiteRow[] = (
    (usageRes.data ?? []) as Record<string, unknown>[]
  ).map((u) => {
    const site = u.site as { name: string; wp_url: string } | null;
    return {
      id: u.id as string,
      site_id: u.site_id as string,
      site_name: site?.name ?? "—",
      wp_url: site?.wp_url ?? "",
      wp_media_id:
        typeof u.wp_media_id === "number" ? u.wp_media_id : null,
      wp_source_url: (u.wp_source_url as string | null) ?? null,
      state: u.state as ImageUsageSiteRow["state"],
      transferred_at: (u.transferred_at as string | null) ?? null,
      failure_code: (u.failure_code as string | null) ?? null,
      failure_detail: (u.failure_detail as string | null) ?? null,
      created_at: u.created_at as string,
    };
  });

  const metaRes = await supabase
    .from("image_metadata")
    .select("key, value_jsonb, created_at, updated_at")
    .eq("image_id", id)
    .order("key", { ascending: true });

  if (metaRes.error) {
    return internalError("Failed to fetch image_metadata.", {
      supabase_error: metaRes.error,
    });
  }

  const metadata: ImageMetadataRow[] = (
    (metaRes.data ?? []) as Record<string, unknown>[]
  ).map((m) => ({
    key: m.key as string,
    value_jsonb: m.value_jsonb,
    created_at: m.created_at as string,
    updated_at: m.updated_at as string,
  }));

  return {
    ok: true,
    data: { image, usage, metadata },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// Metadata editing (M5-3)
// ---------------------------------------------------------------------------

export const IMAGE_CAPTION_MAX = 500;
export const IMAGE_ALT_TEXT_MAX = 200;
export const IMAGE_TAG_MAX_LEN = 40;
export const IMAGE_TAGS_MAX_COUNT = 12;

export type UpdateImageMetadataPatch = {
  caption?: string | null;
  alt_text?: string | null;
  tags?: string[];
};

export type UpdateImageMetadataInput = {
  expected_version: number;
  updated_by?: string | null;
  patch: UpdateImageMetadataPatch;
};

export async function updateImageMetadata(
  id: string,
  input: UpdateImageMetadataInput,
): Promise<ApiResponse<ImageListItem & { version_lock: number }>> {
  try {
    return await updateImageMetadataImpl(id, input);
  } catch (err) {
    return internalError(
      `Unhandled error in updateImageMetadata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function updateImageMetadataImpl(
  id: string,
  input: UpdateImageMetadataInput,
): Promise<ApiResponse<ImageListItem & { version_lock: number }>> {
  const supabase = getServiceRoleClient();

  // Build the UPDATE payload. Only touch fields the patch mentions so
  // an unset tags array doesn't clobber an existing one.
  const updateRow: Record<string, unknown> = {
    updated_at: now(),
  };
  if (input.updated_by !== undefined) {
    updateRow.updated_by = input.updated_by;
  }
  if ("caption" in input.patch) {
    updateRow.caption = input.patch.caption;
  }
  if ("alt_text" in input.patch) {
    updateRow.alt_text = input.patch.alt_text;
  }
  if ("tags" in input.patch) {
    updateRow.tags = input.patch.tags ?? [];
  }

  // Increment version_lock atomically by writing the next value. The
  // WHERE clause pins the CURRENT version; zero rows returned = the
  // client's copy was stale.
  updateRow.version_lock = input.expected_version + 1;

  const res = await supabase
    .from("image_library")
    .update(updateRow)
    .eq("id", id)
    .eq("version_lock", input.expected_version)
    .select(
      "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at, version_lock",
    )
    .maybeSingle();

  if (res.error) {
    return internalError("Failed to update image metadata.", {
      supabase_error: res.error,
    });
  }
  if (!res.data) {
    // Zero rows returned: either the id doesn't exist or the version_lock
    // mismatched. Disambiguate with a follow-up SELECT so the UI can
    // show the right message.
    const existsRes = await supabase
      .from("image_library")
      .select("id, version_lock")
      .eq("id", id)
      .maybeSingle();
    if (existsRes.error) {
      return internalError("Failed to re-check image after update.", {
        supabase_error: existsRes.error,
      });
    }
    if (!existsRes.data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No image found with id ${id}.`,
          details: { id },
          retryable: false,
          suggested_action: "The image may have been removed.",
        },
        timestamp: now(),
      };
    }
    return {
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        message: "Another operator changed this image since you opened the editor. Reload to see the latest.",
        details: {
          id,
          current_version: existsRes.data.version_lock,
          expected_version: input.expected_version,
        },
        retryable: true,
        suggested_action:
          "Reload the page to pick up the latest metadata and redo your changes.",
      },
      timestamp: now(),
    };
  }

  const row = res.data as Record<string, unknown>;
  const base = rowToItem(row);
  return {
    ok: true,
    data: {
      ...base,
      version_lock:
        typeof row.version_lock === "number" ? row.version_lock : 1,
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// Soft-delete + restore (M5-4)
// ---------------------------------------------------------------------------

export type SoftDeleteInput = {
  deleted_by?: string | null;
};

export type SoftDeleteResult = {
  id: string;
  deleted_at: string;
};

export async function softDeleteImage(
  id: string,
  input: SoftDeleteInput = {},
): Promise<ApiResponse<SoftDeleteResult>> {
  try {
    return await softDeleteImageImpl(id, input);
  } catch (err) {
    return internalError(
      `Unhandled error in softDeleteImage: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function softDeleteImageImpl(
  id: string,
  input: SoftDeleteInput,
): Promise<ApiResponse<SoftDeleteResult>> {
  const supabase = getServiceRoleClient();

  // Existence check first so we can distinguish NOT_FOUND from
  // IMAGE_IN_USE / already-deleted.
  const existsRes = await supabase
    .from("image_library")
    .select("id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (existsRes.error) {
    return internalError("Failed to look up image.", {
      supabase_error: existsRes.error,
    });
  }
  if (!existsRes.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No image found with id ${id}.`,
        details: { id },
        retryable: false,
        suggested_action: "Verify the image id.",
      },
      timestamp: now(),
    };
  }
  if (existsRes.data.deleted_at) {
    return {
      ok: true,
      data: {
        id: existsRes.data.id as string,
        deleted_at: existsRes.data.deleted_at as string,
      },
      timestamp: now(),
    };
  }

  // Guard: any image_usage row (regardless of state) blocks soft-delete.
  // The FK ON DELETE NO ACTION already prevents a hard delete; this
  // check gives the operator a friendly pre-UPDATE failure with the
  // list of sites that still reference the image.
  const usageRes = await supabase
    .from("image_usage")
    .select("id, site_id, site:sites!inner(name)")
    .eq("image_id", id);
  if (usageRes.error) {
    return internalError("Failed to check image_usage.", {
      supabase_error: usageRes.error,
    });
  }
  const usageRows = (usageRes.data ?? []) as Record<string, unknown>[];
  if (usageRows.length > 0) {
    const siteNames = usageRows
      .map((u) => {
        const site = u.site as { name: string } | null;
        return site?.name ?? "—";
      })
      .filter((n) => n && n !== "—");
    return {
      ok: false,
      error: {
        code: "IMAGE_IN_USE",
        message: `Cannot archive — image is in use on ${usageRows.length} site${
          usageRows.length === 1 ? "" : "s"
        }.`,
        details: {
          id,
          site_count: usageRows.length,
          site_names: siteNames,
        },
        retryable: false,
        suggested_action:
          "Remove the image from each referencing site's pages first, then archive.",
      },
      timestamp: now(),
    };
  }

  const nowIso = now();
  const updateRow: Record<string, unknown> = {
    deleted_at: nowIso,
    updated_at: nowIso,
  };
  if (input.deleted_by !== undefined) {
    updateRow.deleted_by = input.deleted_by;
    updateRow.updated_by = input.deleted_by;
  }

  const res = await supabase
    .from("image_library")
    .update(updateRow)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, deleted_at")
    .maybeSingle();

  if (res.error) {
    return internalError("Failed to soft-delete image.", {
      supabase_error: res.error,
    });
  }
  if (!res.data) {
    // Raced — another operator archived between our existence check
    // and the UPDATE. Treat as idempotent success (the end state is
    // what the caller asked for).
    const readBack = await supabase
      .from("image_library")
      .select("id, deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (readBack.error || !readBack.data?.deleted_at) {
      return internalError("Soft-delete race left image in unexpected state.");
    }
    return {
      ok: true,
      data: {
        id: readBack.data.id as string,
        deleted_at: readBack.data.deleted_at as string,
      },
      timestamp: now(),
    };
  }

  return {
    ok: true,
    data: {
      id: res.data.id as string,
      deleted_at: res.data.deleted_at as string,
    },
    timestamp: now(),
  };
}

export async function restoreImage(
  id: string,
  input: { restored_by?: string | null } = {},
): Promise<ApiResponse<{ id: string }>> {
  try {
    const supabase = getServiceRoleClient();
    const updateRow: Record<string, unknown> = {
      deleted_at: null,
      deleted_by: null,
      updated_at: now(),
    };
    if (input.restored_by !== undefined) {
      updateRow.updated_by = input.restored_by;
    }
    const res = await supabase
      .from("image_library")
      .update(updateRow)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (res.error) {
      return internalError("Failed to restore image.", {
        supabase_error: res.error,
      });
    }
    if (!res.data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No image found with id ${id}.`,
          details: { id },
          retryable: false,
          suggested_action: "Verify the image id.",
        },
        timestamp: now(),
      };
    }
    return {
      ok: true,
      data: { id: res.data.id as string },
      timestamp: now(),
    };
  } catch (err) {
    return internalError(
      `Unhandled error in restoreImage: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
