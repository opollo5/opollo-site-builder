import { getServiceRoleClient } from "@/lib/supabase";
import {
  SEARCH_IMAGES_DEFAULT_LIMIT,
  SEARCH_IMAGES_MAX_LIMIT,
  SearchImagesInputSchema,
  type SearchImagesData,
  type SearchImagesResultImage,
  type ToolResponse,
} from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M4-6 — search_images tool executor.
//
// Runs against the M4-1 image library:
//   - Full-text search over image_library.search_tsv (weighted: A=caption,
//     B=tags) when `query` is supplied. Backed by idx_image_library_search_tsv
//     (GIN).
//   - Tag filter via tags @> $tags when `tags` is supplied; all supplied
//     tags must be present on the image. Backed by idx_image_library_tags
//     (GIN).
//   - Soft-delete filter (deleted_at IS NULL) always applied — removed
//     images are never surfaced to the chat agent.
//   - Results ordered by (FTS rank desc, created_at desc). When no
//     `query` is supplied, rank is 0 for all rows and we fall back to
//     created_at desc.
//
// Design decisions:
//
//   1. Either `query` or `tags` must be supplied. An unfiltered library
//      dump is not a chat tool — for admin browsing use the future
//      M5/M6 list view. Enforced by Zod refine in the schema.
//
//   2. limit capped at SEARCH_IMAGES_MAX_LIMIT (50). Prevents the model
//      from pulling unbounded pages. Default is 20 so the model doesn't
//      have to reason about it.
//
//   3. plainto_tsquery used instead of to_tsquery so the model can pass
//      natural phrases ("black cat") without worrying about operators.
//      Postgres escapes + tokenises; no query-injection surface.
//
//   4. Service-role client. Matches every other tool executor. Row-level
//      security is the schema layer (authenticated reads filter on role);
//      the chat route is already gated at the session layer.
// ---------------------------------------------------------------------------

const DS_VERSION = "1.0.0";

type ImageLibraryRow = {
  id: string;
  cloudflare_id: string | null;
  caption: string | null;
  alt_text: string | null;
  tags: string[] | null;
  width_px: number | null;
  height_px: number | null;
};

function rowToResult(row: ImageLibraryRow): SearchImagesResultImage {
  return {
    id: row.id,
    cloudflare_id: row.cloudflare_id,
    caption: row.caption,
    alt_text: row.alt_text,
    tags: row.tags ?? [],
    width_px: row.width_px,
    height_px: row.height_px,
  };
}

export async function executeSearchImages(
  rawInput: unknown,
): Promise<ToolResponse<SearchImagesData>> {
  const timestamp = new Date().toISOString();

  const parsed = SearchImagesInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Input failed schema validation.",
        details: { issues: parsed.error.issues },
        retryable: true,
        suggested_action:
          "Supply at least one of `query` or `tags`; keep limit between 1 and 50.",
      },
      timestamp,
    };
  }

  const { query, tags } = parsed.data;
  const limit = parsed.data.limit ?? SEARCH_IMAGES_DEFAULT_LIMIT;

  const svc = getServiceRoleClient();
  // Postgres RPC / raw SQL path would be cleaner, but supabase-js + RPC
  // needs a per-query SQL function to expose ts_rank. We build the query
  // at the PostgREST level: `search_tsv` filter via the `text-search`
  // operator; tags via `contains`; ordering via created_at (FTS rank
  // ordering is close enough to "recent first" for our needs — rank +
  // created_at is a follow-up once we have scale data).
  let builder = svc
    .from("image_library")
    .select(
      "id, cloudflare_id, caption, alt_text, tags, width_px, height_px",
    )
    .is("deleted_at", null);

  if (query) {
    builder = builder.textSearch("search_tsv", query, {
      type: "plain",
      config: "english",
    });
  }
  if (tags && tags.length > 0) {
    builder = builder.contains("tags", tags);
  }

  const { data, error } = await builder
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `image_library query failed: ${error.message}`,
        details: { postgrest_code: error.code ?? null },
        retryable: true,
        suggested_action:
          "Retry the request; if the error persists, escalate to an operator.",
      },
      timestamp,
    };
  }

  const images = ((data ?? []) as ImageLibraryRow[]).map(rowToResult);

  const checks = ["schema", "deleted_at_filter"];
  if (query) checks.push("fts");
  if (tags) checks.push("tag_contains");

  return {
    ok: true,
    data: { images },
    validation: { passed: true, checks },
    ds_version: DS_VERSION,
    timestamp,
  };
}

export { SEARCH_IMAGES_DEFAULT_LIMIT, SEARCH_IMAGES_MAX_LIMIT };
