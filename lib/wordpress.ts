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
