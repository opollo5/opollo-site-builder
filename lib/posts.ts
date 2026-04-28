import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M13-1 — per-site posts data layer.
//
// Mirrors lib/pages.ts for the generative columns + admin-list /
// detail / metadata-edit shape, and adds post-specific fields
// (excerpt, published_at, author_id, scheduled status). Backed by
// the `posts` table introduced in migration 0019.
//
// The `content_type` axis is a schema assertion, not a dispatch
// discriminator at this layer: every row in `posts` is CHECK'd to
// `content_type = 'post'` at the DB. The runner's mode='post'
// branch (landing in M13-3) writes here; pages keep writing to
// lib/pages.ts.
//
// All list / detail reads are site-scoped by construction — a post
// belonging to site B fetched via site A's URL returns NOT_FOUND
// (see getPost). Soft-deleted rows (`deleted_at IS NOT NULL`) are
// excluded by default; admin archive views pass `include_archived`.
// ---------------------------------------------------------------------------

export const POST_CONTENT_TYPE = "post" as const;

export const LIST_POSTS_MAX_LIMIT = 100;
export const LIST_POSTS_DEFAULT_LIMIT = 50;

export const POST_TITLE_MIN = 3;
export const POST_TITLE_MAX = 200;
export const POST_SLUG_MAX = 100;
export const POST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const POST_EXCERPT_MAX = 300;

export type PostStatus = "draft" | "published" | "scheduled";
export type PostContentType = typeof POST_CONTENT_TYPE;

// ---------------------------------------------------------------------------
// Zod schemas. Tightened at the DB layer by the 0019 CHECKs; these
// schemas are the app-layer mirror that API routes / runner helpers
// validate against before hitting PostgREST.
// ---------------------------------------------------------------------------

export const PostStatusSchema = z.enum(["draft", "published", "scheduled"]);

export const PostContentTypeSchema = z.literal(POST_CONTENT_TYPE);

export const PostMetadataPatchSchema = z
  .object({
    title: z.string().min(POST_TITLE_MIN).max(POST_TITLE_MAX).optional(),
    slug: z.string().max(POST_SLUG_MAX).regex(POST_SLUG_RE).optional(),
    excerpt: z.string().max(POST_EXCERPT_MAX).nullable().optional(),
    status: PostStatusSchema.optional(),
  })
  .strict();

export type PostMetadataPatch = z.infer<typeof PostMetadataPatchSchema>;

export const CreatePostInputSchema = z
  .object({
    site_id: z.string().uuid(),
    title: z.string().min(POST_TITLE_MIN).max(POST_TITLE_MAX),
    slug: z.string().max(POST_SLUG_MAX).regex(POST_SLUG_RE),
    excerpt: z.string().max(POST_EXCERPT_MAX).nullable().optional(),
    author_id: z.string().uuid().nullable().optional(),
    template_id: z.string().uuid().nullable().optional(),
    design_system_version: z.number().int().min(1),
    content_brief: z.unknown().optional(),
    content_structured: z.unknown().optional(),
    generated_html: z.string().nullable().optional(),
    created_by: z.string().uuid().nullable().optional(),
    // BP-3: parser snapshot (title/slug/meta_*/source_map) for posts
    // created via the entry-point. NULL otherwise.
    metadata: z.unknown().optional(),
    // BP-7: featured image reference (image_library.id). Optional at
    // create time so a draft can save without an image; publish-time
    // gate enforces requirement for entry-point posts (metadata IS NOT
    // NULL).
    featured_image_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;

export type ListPostsForSiteParams = {
  status?: PostStatus;
  query?: string;
  author_id?: string;
  limit?: number;
  offset?: number;
  include_archived?: boolean;
};

export type PostListItem = {
  id: string;
  site_id: string;
  content_type: PostContentType;
  wp_post_id: number | null;
  slug: string;
  title: string;
  excerpt: string | null;
  status: PostStatus;
  published_at: string | null;
  author_id: string | null;
  template_id: string | null;
  design_system_version: number;
  updated_at: string;
  created_at: string;
};

export type PostDetail = PostListItem & {
  content_brief: unknown;
  content_structured: unknown;
  generated_html: string | null;
  last_edited_by: string | null;
  version_lock: number;
  deleted_at: string | null;
  template_name: string | null;
  site_name: string;
  site_wp_url: string;
};

export type ListPostsForSiteResult = {
  items: PostListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type UpdatePostMetadataInput = {
  expected_version: number;
  updated_by?: string | null;
  patch: PostMetadataPatch;
};

export type SoftDeletePostInput = {
  expected_version: number;
  deleted_by?: string | null;
};

const LIGHT_POST_FIELDS =
  "id, site_id, content_type, wp_post_id, slug, title, excerpt, status, published_at, author_id, template_id, design_system_version, updated_at, created_at";

const DETAIL_POST_FIELDS =
  "id, site_id, content_type, wp_post_id, slug, title, excerpt, status, published_at, author_id, template_id, design_system_version, updated_at, created_at, content_brief, content_structured, generated_html, last_edited_by, version_lock, deleted_at";

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
  if (raw === undefined || !Number.isFinite(raw)) return LIST_POSTS_DEFAULT_LIMIT;
  const rounded = Math.floor(raw);
  if (rounded < 1) return 1;
  if (rounded > LIST_POSTS_MAX_LIMIT) return LIST_POSTS_MAX_LIMIT;
  return rounded;
}

function clampOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  const rounded = Math.floor(raw);
  return rounded < 0 ? 0 : rounded;
}

function escapeIlikeLiteral(value: string): string {
  return value.replace(/[%_*]/g, "");
}

function rowToListItem(row: Record<string, unknown>): PostListItem {
  return {
    id: row.id as string,
    site_id: row.site_id as string,
    content_type: POST_CONTENT_TYPE,
    wp_post_id:
      row.wp_post_id === null || row.wp_post_id === undefined
        ? null
        : typeof row.wp_post_id === "number"
          ? row.wp_post_id
          : Number(row.wp_post_id),
    slug: row.slug as string,
    title: row.title as string,
    excerpt: (row.excerpt as string | null) ?? null,
    status: row.status as PostStatus,
    published_at: (row.published_at as string | null) ?? null,
    author_id: (row.author_id as string | null) ?? null,
    template_id: (row.template_id as string | null) ?? null,
    design_system_version: row.design_system_version as number,
    updated_at: row.updated_at as string,
    created_at: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

export async function createPost(
  input: CreatePostInput,
): Promise<ApiResponse<PostListItem & { version_lock: number }>> {
  try {
    const parsed = CreatePostInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "createPost input failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false,
          suggested_action: "Fix the invalid fields and retry.",
        },
        timestamp: now(),
      };
    }
    return await createPostImpl(parsed.data);
  } catch (err) {
    return internalError(
      `Unhandled error in createPost: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function createPostImpl(
  input: CreatePostInput,
): Promise<ApiResponse<PostListItem & { version_lock: number }>> {
  const supabase = getServiceRoleClient();
  const insertRow: Record<string, unknown> = {
    site_id: input.site_id,
    content_type: POST_CONTENT_TYPE,
    title: input.title,
    slug: input.slug,
    design_system_version: input.design_system_version,
    status: "draft" as PostStatus,
  };
  if (input.excerpt !== undefined) insertRow.excerpt = input.excerpt;
  if (input.author_id !== undefined) insertRow.author_id = input.author_id;
  if (input.template_id !== undefined) insertRow.template_id = input.template_id;
  if (input.content_brief !== undefined) insertRow.content_brief = input.content_brief;
  if (input.content_structured !== undefined) {
    insertRow.content_structured = input.content_structured;
  }
  if (input.generated_html !== undefined) insertRow.generated_html = input.generated_html;
  if (input.created_by !== undefined) insertRow.created_by = input.created_by;
  if (input.metadata !== undefined) insertRow.metadata = input.metadata;
  if (input.featured_image_id !== undefined)
    insertRow.featured_image_id = input.featured_image_id;

  const res = await supabase
    .from("posts")
    .insert(insertRow)
    .select(`${LIGHT_POST_FIELDS}, version_lock`)
    .single();

  if (res.error) {
    if (res.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "UNIQUE_VIOLATION",
          message: `Slug "${input.slug}" is already used by another live post on this site.`,
          details: {
            site_id: input.site_id,
            attempted_slug: input.slug,
            postgres_code: "23505",
          },
          retryable: true,
          suggested_action: "Pick a different slug, or archive the conflicting post first.",
        },
        timestamp: now(),
      };
    }
    return internalError("Failed to create post.", { supabase_error: res.error });
  }
  const row = res.data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      ...rowToListItem(row),
      version_lock: typeof row.version_lock === "number" ? row.version_lock : 1,
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// listPostsForSite
// ---------------------------------------------------------------------------

export async function listPostsForSite(
  siteId: string,
  params: ListPostsForSiteParams = {},
): Promise<ApiResponse<ListPostsForSiteResult>> {
  try {
    return await listPostsForSiteImpl(siteId, params);
  } catch (err) {
    return internalError(
      `Unhandled error in listPostsForSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function listPostsForSiteImpl(
  siteId: string,
  params: ListPostsForSiteParams,
): Promise<ApiResponse<ListPostsForSiteResult>> {
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const supabase = getServiceRoleClient();
  const includeArchived = params.include_archived === true;

  let dataQuery = supabase
    .from("posts")
    .select(LIGHT_POST_FIELDS)
    .eq("site_id", siteId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (!includeArchived) dataQuery = dataQuery.is("deleted_at", null);
  if (params.status) dataQuery = dataQuery.eq("status", params.status);
  if (params.author_id) dataQuery = dataQuery.eq("author_id", params.author_id);
  if (params.query && params.query.trim().length > 0) {
    const escaped = escapeIlikeLiteral(params.query.trim());
    dataQuery = dataQuery.or(
      `title.ilike.*${escaped}*,slug.ilike.*${escaped}*`,
    );
  }
  const dataRes = await dataQuery;
  if (dataRes.error) {
    return internalError("Failed to list posts.", { supabase_error: dataRes.error });
  }

  let countQuery = supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);
  if (!includeArchived) countQuery = countQuery.is("deleted_at", null);
  if (params.status) countQuery = countQuery.eq("status", params.status);
  if (params.author_id) countQuery = countQuery.eq("author_id", params.author_id);
  if (params.query && params.query.trim().length > 0) {
    const escaped = escapeIlikeLiteral(params.query.trim());
    countQuery = countQuery.or(
      `title.ilike.*${escaped}*,slug.ilike.*${escaped}*`,
    );
  }
  const countRes = await countQuery;
  if (countRes.error) {
    return internalError("Failed to count posts.", { supabase_error: countRes.error });
  }

  const items = ((dataRes.data ?? []) as Record<string, unknown>[]).map(rowToListItem);
  return {
    ok: true,
    data: { items, total: countRes.count ?? 0, limit, offset },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// getPost
// ---------------------------------------------------------------------------

export async function getPost(
  siteId: string,
  postId: string,
  opts: { include_archived?: boolean } = {},
): Promise<ApiResponse<PostDetail>> {
  try {
    return await getPostImpl(siteId, postId, opts);
  } catch (err) {
    return internalError(
      `Unhandled error in getPost: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function getPostImpl(
  siteId: string,
  postId: string,
  opts: { include_archived?: boolean },
): Promise<ApiResponse<PostDetail>> {
  const supabase = getServiceRoleClient();
  let postQuery = supabase
    .from("posts")
    .select(DETAIL_POST_FIELDS)
    .eq("id", postId)
    .eq("site_id", siteId);
  if (!opts.include_archived) postQuery = postQuery.is("deleted_at", null);
  const postRes = await postQuery.maybeSingle();

  if (postRes.error) {
    return internalError("Failed to fetch post.", { supabase_error: postRes.error });
  }
  if (!postRes.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No post found with id ${postId} under site ${siteId}.`,
        details: { site_id: siteId, post_id: postId },
        retryable: false,
        suggested_action:
          "Verify both ids. Cross-site access via URL manipulation returns NOT_FOUND.",
      },
      timestamp: now(),
    };
  }
  const row = postRes.data as Record<string, unknown>;
  const base = rowToListItem(row);

  const [templateRes, siteRes] = await Promise.all([
    row.template_id
      ? supabase
          .from("design_templates")
          .select("name")
          .eq("id", row.template_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("sites")
      .select("name, wp_url")
      .eq("id", siteId)
      .maybeSingle(),
  ]);

  if (templateRes.error) {
    return internalError("Failed to fetch template.", { supabase_error: templateRes.error });
  }
  if (siteRes.error) {
    return internalError("Failed to fetch site.", { supabase_error: siteRes.error });
  }
  const siteRow = siteRes.data as { name: string; wp_url: string } | null;

  return {
    ok: true,
    data: {
      ...base,
      content_brief: row.content_brief ?? null,
      content_structured: row.content_structured ?? null,
      generated_html: (row.generated_html as string | null) ?? null,
      last_edited_by: (row.last_edited_by as string | null) ?? null,
      version_lock: typeof row.version_lock === "number" ? row.version_lock : 1,
      deleted_at: (row.deleted_at as string | null) ?? null,
      template_name: (templateRes.data as { name: string } | null)?.name ?? null,
      site_name: siteRow?.name ?? "—",
      site_wp_url: siteRow?.wp_url ?? "",
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// updatePostMetadata — optimistic-locked title / slug / excerpt / status
// ---------------------------------------------------------------------------

export async function updatePostMetadata(
  siteId: string,
  postId: string,
  input: UpdatePostMetadataInput,
): Promise<ApiResponse<PostListItem & { version_lock: number }>> {
  try {
    const parsed = PostMetadataPatchSchema.safeParse(input.patch);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "updatePostMetadata patch failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false,
          suggested_action: "Fix the invalid fields and retry.",
        },
        timestamp: now(),
      };
    }
    return await updatePostMetadataImpl(siteId, postId, {
      ...input,
      patch: parsed.data,
    });
  } catch (err) {
    return internalError(
      `Unhandled error in updatePostMetadata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function updatePostMetadataImpl(
  siteId: string,
  postId: string,
  input: UpdatePostMetadataInput,
): Promise<ApiResponse<PostListItem & { version_lock: number }>> {
  const supabase = getServiceRoleClient();

  const updateRow: Record<string, unknown> = {
    updated_at: now(),
    version_lock: input.expected_version + 1,
  };
  if (input.updated_by !== undefined) {
    updateRow.last_edited_by = input.updated_by;
    updateRow.updated_by = input.updated_by;
  }
  if ("title" in input.patch) updateRow.title = input.patch.title;
  if ("slug" in input.patch) updateRow.slug = input.patch.slug;
  if ("excerpt" in input.patch) updateRow.excerpt = input.patch.excerpt;
  if ("status" in input.patch) {
    updateRow.status = input.patch.status;
    // Transitioning into 'published' must carry a published_at so the
    // `posts_published_at_coherent` CHECK holds.
    if (input.patch.status === "published") {
      updateRow.published_at = now();
    }
  }

  const res = await supabase
    .from("posts")
    .update(updateRow)
    .eq("id", postId)
    .eq("site_id", siteId)
    .eq("version_lock", input.expected_version)
    .is("deleted_at", null)
    .select(`${LIGHT_POST_FIELDS}, version_lock`)
    .maybeSingle();

  if (res.error) {
    if (res.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "UNIQUE_VIOLATION",
          message: `Slug "${input.patch.slug}" is already used by another live post on this site.`,
          details: {
            site_id: siteId,
            attempted_slug: input.patch.slug ?? null,
            postgres_code: "23505",
          },
          retryable: true,
          suggested_action:
            "Pick a different slug, or archive the conflicting post first.",
        },
        timestamp: now(),
      };
    }
    return internalError("Failed to update post metadata.", { supabase_error: res.error });
  }

  if (!res.data) {
    return await disambiguateMissingUpdate(siteId, postId, input.expected_version);
  }

  const row = res.data as Record<string, unknown>;
  const base = rowToListItem(row);
  return {
    ok: true,
    data: {
      ...base,
      version_lock: typeof row.version_lock === "number" ? row.version_lock : 1,
    },
    timestamp: now(),
  };
}

// Zero-row UPDATE disambiguation — NOT_FOUND vs VERSION_CONFLICT vs
// already-archived. Runs a follow-up SELECT scoped to the site.
async function disambiguateMissingUpdate(
  siteId: string,
  postId: string,
  expectedVersion: number,
): Promise<ApiResponse<PostListItem & { version_lock: number }>> {
  const supabase = getServiceRoleClient();
  const existsRes = await supabase
    .from("posts")
    .select("id, version_lock, deleted_at")
    .eq("id", postId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (existsRes.error) {
    return internalError("Failed to re-check post after update.", {
      supabase_error: existsRes.error,
    });
  }
  if (!existsRes.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No post found with id ${postId} under site ${siteId}.`,
        details: { site_id: siteId, post_id: postId },
        retryable: false,
        suggested_action: "Verify both ids.",
      },
      timestamp: now(),
    };
  }
  if (existsRes.data.deleted_at) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Post ${postId} has been archived and can't be edited.`,
        details: { site_id: siteId, post_id: postId, archived: true },
        retryable: false,
        suggested_action: "Restore the archived post first, then retry the edit.",
      },
      timestamp: now(),
    };
  }
  return {
    ok: false,
    error: {
      code: "VERSION_CONFLICT",
      message:
        "Another operator changed this post since you opened the editor. Reload to see the latest.",
      details: {
        post_id: postId,
        current_version: existsRes.data.version_lock,
        expected_version: expectedVersion,
      },
      retryable: true,
      suggested_action:
        "Reload the post to pick up the latest metadata and redo your changes.",
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// softDeletePost — soft-delete is the only delete path per
// docs/DATA_CONVENTIONS.md. Sets deleted_at + deleted_by, optimistic-
// locked against expected_version to prevent a stale archive from
// clobbering a concurrent edit.
// ---------------------------------------------------------------------------

export async function softDeletePost(
  siteId: string,
  postId: string,
  input: SoftDeletePostInput,
): Promise<ApiResponse<{ id: string; version_lock: number; deleted_at: string }>> {
  try {
    return await softDeletePostImpl(siteId, postId, input);
  } catch (err) {
    return internalError(
      `Unhandled error in softDeletePost: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function softDeletePostImpl(
  siteId: string,
  postId: string,
  input: SoftDeletePostInput,
): Promise<ApiResponse<{ id: string; version_lock: number; deleted_at: string }>> {
  const supabase = getServiceRoleClient();
  const deletedAt = now();
  const res = await supabase
    .from("posts")
    .update({
      deleted_at: deletedAt,
      deleted_by: input.deleted_by ?? null,
      updated_at: deletedAt,
      version_lock: input.expected_version + 1,
    })
    .eq("id", postId)
    .eq("site_id", siteId)
    .eq("version_lock", input.expected_version)
    .is("deleted_at", null)
    .select("id, version_lock, deleted_at")
    .maybeSingle();

  if (res.error) {
    return internalError("Failed to soft-delete post.", { supabase_error: res.error });
  }
  if (!res.data) {
    const disambiguated = await disambiguateMissingUpdate(
      siteId,
      postId,
      input.expected_version,
    );
    if (disambiguated.ok) {
      // Shouldn't happen — if the row exists with the expected version
      // and isn't archived, the UPDATE above would have matched. Map
      // to INTERNAL_ERROR so the caller sees a distinct signal.
      return internalError(
        "softDeletePost: UPDATE returned zero rows but follow-up SELECT matched.",
        { site_id: siteId, post_id: postId },
      );
    }
    return disambiguated as unknown as ApiResponse<{
      id: string;
      version_lock: number;
      deleted_at: string;
    }>;
  }
  return {
    ok: true,
    data: {
      id: res.data.id as string,
      version_lock:
        typeof res.data.version_lock === "number" ? res.data.version_lock : 1,
      deleted_at: res.data.deleted_at as string,
    },
    timestamp: now(),
  };
}
