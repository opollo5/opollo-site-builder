import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M6-1 — per-site pages data layer.
//
// Read-mostly helpers backing /admin/sites/[id]/pages. Service-role
// client; admin gate enforced above the caller (Server Component +
// API route). Scoped to a single site by construction — every helper
// takes a site_id so an operator can't drill across tenants via URL
// manipulation.
//
// listPagesForSite supports:
//   - Status filter (`draft` | `published`).
//   - page_type filter (free-text CHECK at schema layer; enum list in
//     lib/tool-schemas.ts).
//   - Free-text search on title + slug (case-insensitive ILIKE). Two
//     columns only so there's no full-text infra to maintain here —
//     the search is operator-facing, not model-facing.
//   - Paged at caller-supplied limit + offset with hard caps.
//
// The detail fetcher getPage(siteId, pageId) ALWAYS requires BOTH
// params — a page belonging to site B accessed via site A's URL
// returns NOT_FOUND. Matches the per-tenant admin posture sibling
// slices use.
// ---------------------------------------------------------------------------

export const LIST_PAGES_MAX_LIMIT = 100;
export const LIST_PAGES_DEFAULT_LIMIT = 50;

export type PageStatus = "draft" | "published";

export type ListPagesForSiteParams = {
  status?: PageStatus;
  page_type?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

export type PageListItem = {
  id: string;
  site_id: string;
  wp_page_id: number;
  slug: string;
  title: string;
  page_type: string;
  template_id: string | null;
  design_system_version: number;
  status: PageStatus;
  updated_at: string;
  created_at: string;
};

export type PageDetail = PageListItem & {
  content_brief: unknown;
  content_structured: unknown;
  generated_html: string | null;
  last_edited_by: string | null;
  version_lock: number;
  template_name: string | null;
  site_name: string;
  site_wp_url: string;
};

export type ListPagesForSiteResult = {
  items: PageListItem[];
  total: number;
  limit: number;
  offset: number;
};

const LIGHT_PAGE_FIELDS =
  "id, site_id, wp_page_id, slug, title, page_type, template_id, design_system_version, status, updated_at, created_at";

const DETAIL_PAGE_FIELDS =
  "id, site_id, wp_page_id, slug, title, page_type, template_id, design_system_version, status, updated_at, created_at, content_brief, content_structured, generated_html, last_edited_by, version_lock";

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
  if (raw === undefined || !Number.isFinite(raw)) return LIST_PAGES_DEFAULT_LIMIT;
  const rounded = Math.floor(raw);
  if (rounded < 1) return 1;
  if (rounded > LIST_PAGES_MAX_LIMIT) return LIST_PAGES_MAX_LIMIT;
  return rounded;
}

function clampOffset(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 0;
  const rounded = Math.floor(raw);
  return rounded < 0 ? 0 : rounded;
}

function escapeIlikeLiteral(value: string): string {
  // PostgREST's `ilike` accepts the `*` wildcard glob; a literal `*`
  // or `%` in the user's search term would expand unexpectedly. Strip
  // control characters and escape wildcards before interpolation.
  return value.replace(/[%_*]/g, "");
}

function bytesToRow(row: Record<string, unknown>): PageListItem {
  return {
    id: row.id as string,
    site_id: row.site_id as string,
    wp_page_id:
      typeof row.wp_page_id === "number"
        ? row.wp_page_id
        : Number(row.wp_page_id),
    slug: row.slug as string,
    title: row.title as string,
    page_type: row.page_type as string,
    template_id: (row.template_id as string | null) ?? null,
    design_system_version: row.design_system_version as number,
    status: row.status as PageStatus,
    updated_at: row.updated_at as string,
    created_at: row.created_at as string,
  };
}

export async function listPagesForSite(
  siteId: string,
  params: ListPagesForSiteParams = {},
): Promise<ApiResponse<ListPagesForSiteResult>> {
  try {
    return await listPagesForSiteImpl(siteId, params);
  } catch (err) {
    return internalError(
      `Unhandled error in listPagesForSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function listPagesForSiteImpl(
  siteId: string,
  params: ListPagesForSiteParams,
): Promise<ApiResponse<ListPagesForSiteResult>> {
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const supabase = getServiceRoleClient();

  let dataQuery = supabase
    .from("pages")
    .select(LIGHT_PAGE_FIELDS)
    .eq("site_id", siteId)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (params.status) {
    dataQuery = dataQuery.eq("status", params.status);
  }
  if (params.page_type) {
    dataQuery = dataQuery.eq("page_type", params.page_type);
  }
  if (params.query && params.query.trim().length > 0) {
    const escaped = escapeIlikeLiteral(params.query.trim());
    // PostgREST `.or()` pattern — each term is a PostgREST expression.
    dataQuery = dataQuery.or(
      `title.ilike.*${escaped}*,slug.ilike.*${escaped}*`,
    );
  }
  const dataRes = await dataQuery;
  if (dataRes.error) {
    return internalError("Failed to list pages.", {
      supabase_error: dataRes.error,
    });
  }

  let countQuery = supabase
    .from("pages")
    .select("id", { count: "exact", head: true })
    .eq("site_id", siteId);
  if (params.status) countQuery = countQuery.eq("status", params.status);
  if (params.page_type) countQuery = countQuery.eq("page_type", params.page_type);
  if (params.query && params.query.trim().length > 0) {
    const escaped = escapeIlikeLiteral(params.query.trim());
    countQuery = countQuery.or(
      `title.ilike.*${escaped}*,slug.ilike.*${escaped}*`,
    );
  }
  const countRes = await countQuery;
  if (countRes.error) {
    return internalError("Failed to count pages.", {
      supabase_error: countRes.error,
    });
  }

  const items = ((dataRes.data ?? []) as Record<string, unknown>[]).map(
    bytesToRow,
  );
  return {
    ok: true,
    data: {
      items,
      total: countRes.count ?? 0,
      limit,
      offset,
    },
    timestamp: now(),
  };
}

export async function getPage(
  siteId: string,
  pageId: string,
): Promise<ApiResponse<PageDetail>> {
  try {
    return await getPageImpl(siteId, pageId);
  } catch (err) {
    return internalError(
      `Unhandled error in getPage: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// updatePageMetadata — optimistic-locked title / slug edits (M6-3)
// ---------------------------------------------------------------------------

export const PAGE_TITLE_MIN = 3;
export const PAGE_TITLE_MAX = 160;
export const PAGE_SLUG_MAX = 100;
export const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type UpdatePageMetadataPatch = {
  title?: string;
  slug?: string;
};

export type UpdatePageMetadataInput = {
  expected_version: number;
  updated_by?: string | null;
  patch: UpdatePageMetadataPatch;
};

export async function updatePageMetadata(
  siteId: string,
  pageId: string,
  input: UpdatePageMetadataInput,
): Promise<ApiResponse<PageListItem & { version_lock: number }>> {
  try {
    return await updatePageMetadataImpl(siteId, pageId, input);
  } catch (err) {
    return internalError(
      `Unhandled error in updatePageMetadata: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function updatePageMetadataImpl(
  siteId: string,
  pageId: string,
  input: UpdatePageMetadataInput,
): Promise<ApiResponse<PageListItem & { version_lock: number }>> {
  const supabase = getServiceRoleClient();

  const updateRow: Record<string, unknown> = {
    updated_at: now(),
    version_lock: input.expected_version + 1,
  };
  if (input.updated_by !== undefined) {
    updateRow.last_edited_by = input.updated_by;
  }
  if ("title" in input.patch) updateRow.title = input.patch.title;
  if ("slug" in input.patch) updateRow.slug = input.patch.slug;

  const res = await supabase
    .from("pages")
    .update(updateRow)
    .eq("id", pageId)
    .eq("site_id", siteId)
    .eq("version_lock", input.expected_version)
    .select(
      "id, site_id, wp_page_id, slug, title, page_type, template_id, design_system_version, status, updated_at, created_at, version_lock",
    )
    .maybeSingle();

  if (res.error) {
    // Unique-violation on pages_site_slug_unique (migration 0007) —
    // operator edited the slug to one already used on this site.
    if (res.error.code === "23505") {
      return {
        ok: false,
        error: {
          code: "UNIQUE_VIOLATION",
          message: `Slug "${input.patch.slug}" is already used by another page on this site.`,
          details: {
            site_id: siteId,
            attempted_slug: input.patch.slug ?? null,
            postgres_code: "23505",
          },
          retryable: true,
          suggested_action:
            "Pick a different slug, or archive the conflicting page first.",
        },
        timestamp: now(),
      };
    }
    return internalError("Failed to update page metadata.", {
      supabase_error: res.error,
    });
  }

  if (!res.data) {
    // Zero rows returned: disambiguate NOT_FOUND vs VERSION_CONFLICT
    // with a follow-up SELECT scoped to the site.
    const existsRes = await supabase
      .from("pages")
      .select("id, version_lock")
      .eq("id", pageId)
      .eq("site_id", siteId)
      .maybeSingle();
    if (existsRes.error) {
      return internalError("Failed to re-check page after update.", {
        supabase_error: existsRes.error,
      });
    }
    if (!existsRes.data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No page found with id ${pageId} under site ${siteId}.`,
          details: { site_id: siteId, page_id: pageId },
          retryable: false,
          suggested_action: "Verify both ids.",
        },
        timestamp: now(),
      };
    }
    return {
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        message:
          "Another operator changed this page since you opened the editor. Reload to see the latest.",
        details: {
          page_id: pageId,
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
  const base = bytesToRow(row);
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

async function getPageImpl(
  siteId: string,
  pageId: string,
): Promise<ApiResponse<PageDetail>> {
  const supabase = getServiceRoleClient();
  const pageRes = await supabase
    .from("pages")
    .select(DETAIL_PAGE_FIELDS)
    .eq("id", pageId)
    .eq("site_id", siteId)
    .maybeSingle();

  if (pageRes.error) {
    return internalError("Failed to fetch page.", {
      supabase_error: pageRes.error,
    });
  }
  if (!pageRes.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No page found with id ${pageId} under site ${siteId}.`,
        details: { site_id: siteId, page_id: pageId },
        retryable: false,
        suggested_action:
          "Verify both ids. Cross-site access via URL manipulation returns NOT_FOUND.",
      },
      timestamp: now(),
    };
  }
  const row = pageRes.data as Record<string, unknown>;
  const base = bytesToRow(row);

  // Resolve site + template names for UI rendering. Both are optional
  // lookups; missing either one yields a "—" in the UI but keeps the
  // detail reachable.
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
    return internalError("Failed to fetch template.", {
      supabase_error: templateRes.error,
    });
  }
  if (siteRes.error) {
    return internalError("Failed to fetch site.", {
      supabase_error: siteRes.error,
    });
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
      version_lock:
        typeof row.version_lock === "number" ? row.version_lock : 1,
      template_name:
        (templateRes.data as { name: string } | null)?.name ?? null,
      site_name: siteRow?.name ?? "—",
      site_wp_url: siteRow?.wp_url ?? "",
    },
    timestamp: now(),
  };
}
