import { AsyncLocalStorage } from "node:async_hooks";

import type {
  CreatePageData,
  CreatePageInput,
  DeletePageData,
  GetPageData,
  ListPagesInput,
  PageListItem,
  PublishPageData,
  UpdatePageData,
} from "./tool-schemas";

export type WpConfig = {
  baseUrl: string;
  user: string;
  appPassword: string;
};

export type WpCredentialsOverride = {
  wp_url: string;
  wp_user: string;
  wp_app_password: string;
};

export type WpConfigResult =
  | { ok: true; value: WpConfig }
  | { ok: false; missing: string[] };

// Per-invocation credentials override. The chat route wraps each tool call
// in runWithWpCredentials(creds, …) so readWpConfig(), which still lives in
// the existing tool executors, picks the site's credentials up without any
// signature change. When no override is set, readWpConfig() falls back to
// the LEADSOURCE_* env vars (backward compatibility during Week 2).
const credentialsContext = new AsyncLocalStorage<WpCredentialsOverride>();

export function runWithWpCredentials<T>(
  creds: WpCredentialsOverride | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!creds) return fn();
  return credentialsContext.run(creds, fn);
}

export function readWpConfig(): WpConfigResult {
  const override = credentialsContext.getStore();
  if (override) {
    return {
      ok: true,
      value: {
        baseUrl: override.wp_url,
        user: override.wp_user,
        appPassword: override.wp_app_password,
      },
    };
  }

  const baseUrl = process.env.LEADSOURCE_WP_URL;
  const user = process.env.LEADSOURCE_WP_USER;
  const appPassword = process.env.LEADSOURCE_WP_APP_PASSWORD;
  const missing: string[] = [];
  if (!baseUrl) missing.push("LEADSOURCE_WP_URL");
  if (!user) missing.push("LEADSOURCE_WP_USER");
  if (!appPassword) missing.push("LEADSOURCE_WP_APP_PASSWORD");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    value: { baseUrl: baseUrl!, user: user!, appPassword: appPassword! },
  };
}

type WpErrorCode =
  | "AUTH_FAILED"
  | "UPSTREAM_BLOCKED"
  | "WP_API_ERROR"
  | "NETWORK_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMIT";

export type WpError = {
  ok: false;
  code: WpErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  suggested_action: string;
};

export type WpResult<T> = ({ ok: true } & T) | WpError;

export type WpCreatePageResult = WpResult<CreatePageData>;
export type WpListPagesResult = WpResult<{ pages: PageListItem[] }>;
export type WpGetPageResult = WpResult<GetPageData>;
export type WpUpdatePageResult = WpResult<UpdatePageData & { status: string }>;
export type WpPublishPageResult = WpResult<PublishPageData>;
export type WpDeletePageResult = WpResult<DeletePageData>;

export type WpUpdateFields = {
  title?: string;
  content?: string;
  meta_description?: string;
  status?: string;
  /**
   * M7-5: drift reconciliation. When set, WP renames `post_name`
   * atomically in the same PUT. Leave undefined to keep the existing
   * slug.
   */
  slug?: string;
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function authHeader(cfg: WpConfig): string {
  const token = Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64");
  return `Basic ${token}`;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function wpFetch(
  cfg: WpConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${trimTrailingSlash(cfg.baseUrl)}${path}`;
  const headers: Record<string, string> = {
    Authorization: authHeader(cfg),
    "Content-Type": "application/json",
    Accept: "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("WordPress fetch failed after retries");
}

async function mapHttpErrorToWpError(res: Response): Promise<WpError | null> {
  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (res.status === 403 && !isJson) {
    const snippet = (await res.text()).slice(0, 300);
    return {
      ok: false,
      code: "UPSTREAM_BLOCKED",
      message:
        "WordPress host returned a non-JSON 403 — likely a WAF, CDN, or hosting-level block.",
      details: { status: 403, content_type: contentType, body_snippet: snippet },
      retryable: false,
      suggested_action:
        "Check WAF/CDN rules, security plugins, or IP allowlisting on the WordPress host.",
    };
  }

  if (res.status === 401 || (res.status === 403 && isJson)) {
    let wpBody: unknown = undefined;
    try {
      wpBody = await res.json();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      code: "AUTH_FAILED",
      message: "WordPress rejected the Application Password credentials.",
      details: { status: res.status, wp_response: wpBody },
      retryable: false,
      suggested_action:
        "Verify the site's WordPress user and application password, and that Application Passwords are enabled on the host.",
    };
  }

  if (res.status === 404) {
    let wpBody: unknown = undefined;
    try {
      wpBody = await res.json();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "WordPress resource not found.",
      details: { status: 404, wp_response: wpBody },
      retryable: false,
      suggested_action: "Verify the page_id or slug exists.",
    };
  }

  if (res.status === 429) {
    return {
      ok: false,
      code: "RATE_LIMIT",
      message: "WordPress responded with 429 Too Many Requests.",
      details: { status: 429 },
      retryable: true,
      suggested_action: "Back off and retry after a short delay.",
    };
  }

  if (!res.ok) {
    let wpBody: unknown = undefined;
    try {
      wpBody = await res.json();
    } catch {
      /* swallow */
    }
    return {
      ok: false,
      code: "WP_API_ERROR",
      message: `WordPress API error (HTTP ${res.status}).`,
      details: { status: res.status, wp_response: wpBody },
      retryable: res.status >= 500,
      suggested_action:
        res.status >= 500
          ? "Retry after a short delay; WordPress may be transiently unavailable."
          : "Review the payload for invalid fields or conflicts.",
    };
  }

  return null;
}

function networkError(err: unknown): WpError {
  return {
    ok: false,
    code: "NETWORK_ERROR",
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
    suggested_action: "Check network connectivity to the WordPress host.",
  };
}

async function parseJsonOrError<T>(
  res: Response,
): Promise<{ ok: true; body: T } | WpError> {
  try {
    const body = (await res.json()) as T;
    return { ok: true, body };
  } catch (err) {
    return {
      ok: false,
      code: "WP_API_ERROR",
      message: "WordPress returned a success status but invalid JSON.",
      details: { parse_error: err instanceof Error ? err.message : String(err) },
      retryable: false,
      suggested_action:
        "Inspect the WordPress host for proxy/cache misconfiguration.",
    };
  }
}

function renderedString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "rendered" in (value as any)) {
    const rendered = (value as { rendered?: unknown }).rendered;
    return typeof rendered === "string" ? rendered : "";
  }
  return "";
}

function rawString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as { raw?: unknown; rendered?: unknown };
    if (typeof obj.raw === "string") return obj.raw;
    if (typeof obj.rendered === "string") return obj.rendered;
  }
  return "";
}

function toPageListItem(raw: any): PageListItem {
  return {
    page_id: Number(raw.id),
    title: renderedString(raw.title),
    slug: typeof raw.slug === "string" ? raw.slug : "",
    status: typeof raw.status === "string" ? raw.status : "",
    parent_id:
      typeof raw.parent === "number" && raw.parent > 0 ? raw.parent : null,
    modified_date:
      typeof raw.modified_gmt === "string"
        ? raw.modified_gmt
        : typeof raw.modified === "string"
          ? raw.modified
          : "",
  };
}

// ---------- wpCreatePage ----------

export async function wpCreatePage(
  cfg: WpConfig,
  input: CreatePageInput,
): Promise<WpCreatePageResult> {
  let res: Response;
  try {
    res = await wpFetch(cfg, "/wp-json/wp/v2/pages", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        slug: input.slug,
        content: input.content,
        status: "draft",
        excerpt: input.meta_description,
      }),
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  const base = trimTrailingSlash(cfg.baseUrl);
  return {
    ok: true,
    page_id: Number(body.id),
    preview_url: `${base}/?page_id=${body.id}&preview=true`,
    admin_url: `${base}/wp-admin/post.php?post=${body.id}&action=edit`,
    slug: typeof body.slug === "string" ? body.slug : input.slug,
    status: typeof body.status === "string" ? body.status : "draft",
  };
}

// ---------- wpListPages ----------

async function resolveSlugToId(
  cfg: WpConfig,
  slug: string,
): Promise<{ ok: true; id: number | null } | WpError> {
  let res: Response;
  try {
    res = await wpFetch(
      cfg,
      `/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&status=any&per_page=1&_fields=id`,
      { method: "GET" },
    );
  } catch (err) {
    return networkError(err);
  }
  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;
  const parsed = await parseJsonOrError<any[]>(res);
  if (!parsed.ok) return parsed;
  const id = parsed.body[0]?.id;
  return { ok: true, id: typeof id === "number" ? id : null };
}

export async function wpListPages(
  cfg: WpConfig,
  input: ListPagesInput,
): Promise<WpListPagesResult> {
  let parentId: number | null | undefined = undefined;
  if (input.parent_slug) {
    const resolved = await resolveSlugToId(cfg, input.parent_slug);
    if (!("ok" in resolved) || !resolved.ok) return resolved;
    if (resolved.id === null) {
      return { ok: true, pages: [] };
    }
    parentId = resolved.id;
  }

  const qs = new URLSearchParams();
  qs.set("per_page", "100");
  qs.set(
    "_fields",
    "id,title,slug,status,parent,modified,modified_gmt",
  );
  const status = input.status ?? "any";
  qs.set("status", status);
  if (parentId !== undefined && parentId !== null) {
    qs.set("parent", String(parentId));
  }
  if (input.search) qs.set("search", input.search);

  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/pages?${qs.toString()}`, {
      method: "GET",
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any[]>(res);
  if (!parsed.ok) return parsed;

  const pages = Array.isArray(parsed.body)
    ? parsed.body.map(toPageListItem)
    : [];
  return { ok: true, pages };
}

// ---------- wpGetPage ----------

export async function wpGetPage(
  cfg: WpConfig,
  pageId: number,
): Promise<WpGetPageResult> {
  let res: Response;
  try {
    res = await wpFetch(
      cfg,
      `/wp-json/wp/v2/pages/${pageId}?context=edit`,
      { method: "GET" },
    );
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  return {
    ok: true,
    page_id: Number(body.id),
    title: rawString(body.title),
    slug: typeof body.slug === "string" ? body.slug : "",
    content: rawString(body.content),
    meta_description: rawString(body.excerpt),
    status: typeof body.status === "string" ? body.status : "",
    parent_id:
      typeof body.parent === "number" && body.parent > 0 ? body.parent : null,
    modified_date:
      typeof body.modified_gmt === "string"
        ? body.modified_gmt
        : typeof body.modified === "string"
          ? body.modified
          : "",
  };
}

// ---------- wpUpdatePage ----------

export async function wpUpdatePage(
  cfg: WpConfig,
  pageId: number,
  fields: WpUpdateFields,
): Promise<WpUpdatePageResult> {
  const wpBody: Record<string, unknown> = {};
  if (fields.title !== undefined) wpBody.title = fields.title;
  if (fields.content !== undefined) wpBody.content = fields.content;
  if (fields.meta_description !== undefined) {
    wpBody.excerpt = fields.meta_description;
  }
  if (fields.status !== undefined) wpBody.status = fields.status;
  if (fields.slug !== undefined) wpBody.slug = fields.slug;

  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/pages/${pageId}`, {
      method: "POST",
      body: JSON.stringify(wpBody),
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  return {
    ok: true,
    page_id: Number(body.id),
    status: typeof body.status === "string" ? body.status : "",
    modified_date:
      typeof body.modified_gmt === "string"
        ? body.modified_gmt
        : typeof body.modified === "string"
          ? body.modified
          : "",
  };
}

// ---------- wpPublishPage ----------

export async function wpPublishPage(
  cfg: WpConfig,
  pageId: number,
): Promise<WpPublishPageResult> {
  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/pages/${pageId}`, {
      method: "POST",
      body: JSON.stringify({ status: "publish" }),
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  const base = trimTrailingSlash(cfg.baseUrl);
  const publishedUrl =
    typeof body.link === "string" && body.link.length > 0
      ? body.link
      : `${base}/?page_id=${body.id}`;

  return {
    ok: true,
    page_id: Number(body.id),
    status: typeof body.status === "string" ? body.status : "",
    published_url: publishedUrl,
  };
}

// ---------- wpDeletePage ----------

export async function wpDeletePage(
  cfg: WpConfig,
  pageId: number,
): Promise<WpDeletePageResult> {
  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/pages/${pageId}`, {
      method: "DELETE",
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  const id = Number(body?.id ?? body?.previous?.id ?? pageId);
  return {
    ok: true,
    page_id: id,
    status: "trash",
  };
}

// ===========================================================================
// M13-2 — WordPress REST posts wrapper
//
// Additive counterpart to the wpCreatePage / wpUpdatePage / wpGetPage /
// wpDeletePage helpers above. Posts hit /wp-json/wp/v2/posts (NOT
// /pages), which carries taxonomies (categories / tags), featured
// media, and — if installed — SEO plugin meta. These wrappers deliberately
// do not touch the page helpers so the chat tools (M7 page-publish path)
// stay independent of the post surface.
//
// Shape invariants:
//   - Inputs/outputs mirror the page wrappers where they overlap
//     (title, slug, content, excerpt).
//   - Post-specific extensions (categories, tags, featured_media, meta)
//     are OPTIONAL on the Input type; a missing field is not sent to
//     WP (preserves existing WP values on UPDATE; omits on CREATE).
//   - Same Basic-Auth header, same exponential-backoff retry via
//     wpFetch, same error mapping through mapHttpErrorToWpError — the
//     operator sees AUTH_FAILED / UPSTREAM_BLOCKED / NOT_FOUND /
//     RATE_LIMIT / WP_API_ERROR exactly as they do on pages today.
// ===========================================================================

export type WpPostStatus = "draft" | "publish" | "pending" | "private" | "future";

export type WpCreatePostInput = {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  /** Defaults to "draft" when omitted. */
  status?: WpPostStatus;
  /** Category term IDs as stored in WP (/wp/v2/categories). */
  categories?: number[];
  /** Tag term IDs as stored in WP (/wp/v2/tags). */
  tags?: number[];
  /** Media attachment ID from /wp/v2/media — the featured image. */
  featured_media?: number;
  /** Raw WP `meta` object. Yoast / RankMath / SEOPress meta fields go here. */
  meta?: Record<string, unknown>;
};

export type WpUpdatePostFields = {
  title?: string;
  slug?: string;
  content?: string;
  excerpt?: string;
  status?: WpPostStatus;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  meta?: Record<string, unknown>;
};

export type WpPostRecord = {
  post_id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: string;
  categories: number[];
  tags: number[];
  featured_media: number | null;
  link: string;
  modified_date: string;
};

export type WpCreatePostData = {
  post_id: number;
  preview_url: string;
  admin_url: string;
  slug: string;
  status: string;
  link: string;
};

export type WpUpdatePostData = {
  post_id: number;
  slug: string;
  status: string;
  modified_date: string;
};

export type WpDeletePostData = {
  post_id: number;
  status: "trash" | "deleted";
};

export type WpCreatePostResult = WpResult<WpCreatePostData>;
export type WpUpdatePostResult = WpResult<WpUpdatePostData>;
export type WpGetPostResult = WpResult<WpPostRecord>;
export type WpDeletePostResult = WpResult<WpDeletePostData>;

function toPostRecord(raw: any): WpPostRecord {
  const categories = Array.isArray(raw?.categories)
    ? (raw.categories as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : [];
  const tags = Array.isArray(raw?.tags)
    ? (raw.tags as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : [];
  const featured =
    typeof raw?.featured_media === "number" && raw.featured_media > 0
      ? raw.featured_media
      : null;
  return {
    post_id: Number(raw?.id),
    title: rawString(raw?.title),
    slug: typeof raw?.slug === "string" ? raw.slug : "",
    content: rawString(raw?.content),
    excerpt: rawString(raw?.excerpt),
    status: typeof raw?.status === "string" ? raw.status : "",
    categories,
    tags,
    featured_media: featured,
    link: typeof raw?.link === "string" ? raw.link : "",
    modified_date:
      typeof raw?.modified_gmt === "string"
        ? raw.modified_gmt
        : typeof raw?.modified === "string"
          ? raw.modified
          : "",
  };
}

function buildCreatePostBody(input: WpCreatePostInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: input.content,
    status: input.status ?? "draft",
  };
  if (input.excerpt !== undefined) body.excerpt = input.excerpt;
  if (input.categories !== undefined) body.categories = input.categories;
  if (input.tags !== undefined) body.tags = input.tags;
  if (input.featured_media !== undefined) body.featured_media = input.featured_media;
  if (input.meta !== undefined) body.meta = input.meta;
  return body;
}

function buildUpdatePostBody(fields: WpUpdatePostFields): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.slug !== undefined) body.slug = fields.slug;
  if (fields.content !== undefined) body.content = fields.content;
  if (fields.excerpt !== undefined) body.excerpt = fields.excerpt;
  if (fields.status !== undefined) body.status = fields.status;
  if (fields.categories !== undefined) body.categories = fields.categories;
  if (fields.tags !== undefined) body.tags = fields.tags;
  if (fields.featured_media !== undefined) body.featured_media = fields.featured_media;
  if (fields.meta !== undefined) body.meta = fields.meta;
  return body;
}

// ---------- wpCreatePost ----------

export async function wpCreatePost(
  cfg: WpConfig,
  input: WpCreatePostInput,
): Promise<WpCreatePostResult> {
  let res: Response;
  try {
    res = await wpFetch(cfg, "/wp-json/wp/v2/posts", {
      method: "POST",
      body: JSON.stringify(buildCreatePostBody(input)),
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  const base = trimTrailingSlash(cfg.baseUrl);
  const id = Number(body?.id);
  return {
    ok: true,
    post_id: id,
    preview_url: `${base}/?p=${id}&preview=true`,
    admin_url: `${base}/wp-admin/post.php?post=${id}&action=edit`,
    slug: typeof body?.slug === "string" ? body.slug : input.slug,
    status: typeof body?.status === "string" ? body.status : (input.status ?? "draft"),
    link: typeof body?.link === "string" ? body.link : `${base}/?p=${id}`,
  };
}

// ---------- wpUpdatePost ----------

export async function wpUpdatePost(
  cfg: WpConfig,
  postId: number,
  fields: WpUpdatePostFields,
): Promise<WpUpdatePostResult> {
  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/posts/${postId}`, {
      method: "POST",
      body: JSON.stringify(buildUpdatePostBody(fields)),
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  return {
    ok: true,
    post_id: Number(body?.id ?? postId),
    slug: typeof body?.slug === "string" ? body.slug : "",
    status: typeof body?.status === "string" ? body.status : "",
    modified_date:
      typeof body?.modified_gmt === "string"
        ? body.modified_gmt
        : typeof body?.modified === "string"
          ? body.modified
          : "",
  };
}

// ---------- wpGetPostBySlug ----------

export async function wpGetPostBySlug(
  cfg: WpConfig,
  slug: string,
  opts: { status?: "any" | WpPostStatus } = {},
): Promise<WpGetPostResult> {
  // WP returns an array when queried by slug; empty array → NOT_FOUND,
  // first element → the post record. Using context=edit to fetch the
  // raw (un-rendered) fields the operator/runner needs to round-trip.
  const status = opts.status ?? "any";
  const qs = new URLSearchParams();
  qs.set("slug", slug);
  qs.set("status", status);
  qs.set("per_page", "1");
  qs.set("context", "edit");

  let res: Response;
  try {
    res = await wpFetch(cfg, `/wp-json/wp/v2/posts?${qs.toString()}`, {
      method: "GET",
    });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any[]>(res);
  if (!parsed.ok) return parsed;
  const list = Array.isArray(parsed.body) ? parsed.body : [];
  if (list.length === 0) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No post found with slug "${slug}".`,
      details: { slug, status },
      retryable: false,
      suggested_action: "Verify the slug and status filter.",
    };
  }
  return { ok: true, ...toPostRecord(list[0]) };
}

// ---------- wpDeletePost ----------

export async function wpDeletePost(
  cfg: WpConfig,
  postId: number,
  opts: { force?: boolean } = {},
): Promise<WpDeletePostResult> {
  // WP's default DELETE on /posts/:id sends the row to trash (recoverable).
  // ?force=true bypasses trash and hard-deletes — reserved for operator
  // "permanent delete" actions. Opollo's default is trash (recoverable).
  const path = opts.force
    ? `/wp-json/wp/v2/posts/${postId}?force=true`
    : `/wp-json/wp/v2/posts/${postId}`;

  let res: Response;
  try {
    res = await wpFetch(cfg, path, { method: "DELETE" });
  } catch (err) {
    return networkError(err);
  }

  const mapped = await mapHttpErrorToWpError(res);
  if (mapped) return mapped;

  const parsed = await parseJsonOrError<any>(res);
  if (!parsed.ok) return parsed;
  const body = parsed.body;

  const id = Number(body?.id ?? body?.previous?.id ?? postId);
  return {
    ok: true,
    post_id: id,
    status: opts.force ? "deleted" : "trash",
  };
}
