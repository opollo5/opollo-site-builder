import type { CreatePageInput, CreatePageData } from "./tool-schemas";

export type WpConfig = {
  baseUrl: string;
  user: string;
  appPassword: string;
};

type WpErrorCode =
  | "AUTH_FAILED"
  | "UPSTREAM_BLOCKED"
  | "WP_API_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMIT";

export type WpError = {
  ok: false;
  code: WpErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  suggested_action: string;
};

export type WpCreatePageResult =
  | ({ ok: true } & CreatePageData)
  | WpError;

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
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
      suggested_action: "Check network connectivity to the WordPress host.",
    };
  }

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
        "Verify LEADSOURCE_WP_USER and LEADSOURCE_WP_APP_PASSWORD, and that Application Passwords are enabled.",
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

  let body: any;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      code: "WP_API_ERROR",
      message: "WordPress returned a success status but invalid JSON.",
      details: { parse_error: err instanceof Error ? err.message : String(err) },
      retryable: false,
      suggested_action: "Inspect the WordPress host for proxy/cache misconfiguration.",
    };
  }

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
