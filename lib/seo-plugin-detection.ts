import type { WpConfig, WpError } from "./wordpress";

// ---------------------------------------------------------------------------
// M13-2 — SEO plugin fingerprint for a WordPress site.
//
// Hits `/wp-json/` once and inspects the `namespaces` array to decide
// which SEO plugin (if any) is installed + activated. The namespaces
// list is the authoritative source: a plugin exposes a REST namespace
// iff it's active on the site, so "namespace present" = "plugin
// writable from the REST API".
//
// Fingerprint table:
//
//   Yoast SEO          →  `yoast/v1` (also `wp-api/v1`, `wp/v2/.*` on older)
//   Rank Math          →  `rankmath/v1`
//   SEOPress           →  `seopress/v1`
//
// When more than one SEO plugin shows up (rare, usually a misconfigured
// site), we return the first-match by priority: Yoast > Rank Math >
// SEOPress. The caller can inspect `result.allDetected` to see the
// full list.
//
// This is a READ-only probe. No writes, no meta queries. The M13-4
// admin surface uses the result to:
//   - gate publish when a brief declares Yoast meta fields and Yoast
//     isn't installed (surfaces a translated blocker before confirm);
//   - populate the Appearance panel's "plugins detected" row;
//   - key into `lib/error-translations.ts` for plugin-specific REST
//     failure messages.
//
// Failure modes:
//   - WP is offline / auth fails → propagate the `WpError` from the
//     shared wordpress.ts helper. The admin surface treats any failure
//     as "detection unavailable" and surfaces the underlying error,
//     not a fake "no plugin" result.
// ---------------------------------------------------------------------------

export type SeoPluginName = "yoast" | "rank-math" | "seopress";

export type SeoPluginInfo = {
  name: SeoPluginName;
  namespace: string;
  displayName: string;
};

export type DetectSeoPluginsOk = {
  ok: true;
  /** Primary detection — first-match by priority (yoast > rank-math > seopress). Null when none present. */
  plugin: SeoPluginInfo | null;
  /** All SEO-related namespaces found in /wp-json/. Empty array when none present. */
  allDetected: SeoPluginInfo[];
  /** Raw namespaces list from WP, exposed for diagnostics. */
  namespaces: string[];
};

export type DetectSeoPluginsResult = DetectSeoPluginsOk | WpError;

// Priority order: first match wins when multiple SEO plugins are
// detected. Yoast is most common, Rank Math second, SEOPress third.
const PLUGIN_DEFS: ReadonlyArray<{
  name: SeoPluginName;
  displayName: string;
  matcher: (ns: string) => string | null;
}> = [
  {
    name: "yoast",
    displayName: "Yoast SEO",
    matcher: (ns) =>
      ns === "yoast/v1" || ns.startsWith("yoast/") ? ns : null,
  },
  {
    name: "rank-math",
    displayName: "Rank Math",
    matcher: (ns) =>
      ns === "rankmath/v1" || ns.startsWith("rankmath/") ? ns : null,
  },
  {
    name: "seopress",
    displayName: "SEOPress",
    matcher: (ns) =>
      ns === "seopress/v1" || ns.startsWith("seopress/") ? ns : null,
  },
];

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function authHeader(cfg: WpConfig): string {
  const token = Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64");
  return `Basic ${token}`;
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

/**
 * Inspect an array of namespace strings and produce the detection result
 * synchronously. Exported for unit testing the fingerprint table
 * without a live WP.
 */
export function fingerprintFromNamespaces(
  namespaces: readonly unknown[],
): Pick<DetectSeoPluginsOk, "plugin" | "allDetected"> {
  // Defensive filter — the input comes from WP's /wp-json/ response,
  // which occasionally mixes in non-string entries on older WP + plugin
  // combinations. Drop anything that isn't a string before fingerprinting
  // so a single bad entry can't crash the whole detection pass.
  const strings = namespaces.filter((n): n is string => typeof n === "string");
  const hits: SeoPluginInfo[] = [];
  const seen = new Set<SeoPluginName>();
  for (const def of PLUGIN_DEFS) {
    for (const ns of strings) {
      const matched = def.matcher(ns);
      if (!matched) continue;
      if (seen.has(def.name)) continue;
      hits.push({
        name: def.name,
        namespace: matched,
        displayName: def.displayName,
      });
      seen.add(def.name);
      break;
    }
  }
  return {
    plugin: hits[0] ?? null,
    allDetected: hits,
  };
}

/**
 * Hit the WP site's `/wp-json/` root and fingerprint the installed SEO
 * plugin from the `namespaces` array.
 *
 * No retries — the discovery surface is not worth retrying against a
 * degraded host; the caller surfaces "detection unavailable" on error.
 */
export async function detectSeoPlugins(
  cfg: WpConfig,
): Promise<DetectSeoPluginsResult> {
  const url = `${trimTrailingSlash(cfg.baseUrl)}/wp-json/`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader(cfg),
        Accept: "application/json",
      },
    });
  } catch (err) {
    return networkError(err);
  }

  if (res.status === 401 || res.status === 403) {
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
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "WordPress REST API root not found — is /wp-json/ exposed on this host?",
      details: { status: 404, url },
      retryable: false,
      suggested_action:
        "Check permalinks (Settings → Permalinks), and that no security plugin / firewall is blocking /wp-json/.",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      code: "WP_API_ERROR",
      message: `WordPress /wp-json/ returned HTTP ${res.status}.`,
      details: { status: res.status },
      retryable: res.status >= 500,
      suggested_action:
        res.status >= 500
          ? "Retry after a short delay; WordPress may be transiently unavailable."
          : "Inspect the WordPress host for proxy/cache misconfiguration.",
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      code: "WP_API_ERROR",
      message: "WordPress /wp-json/ returned a success status but invalid JSON.",
      details: {
        parse_error: err instanceof Error ? err.message : String(err),
      },
      retryable: false,
      suggested_action:
        "Inspect the WordPress host for proxy/cache misconfiguration.",
    };
  }

  const namespaces: string[] =
    body && typeof body === "object" && Array.isArray((body as { namespaces?: unknown }).namespaces)
      ? ((body as { namespaces: unknown[] }).namespaces.filter(
          (n): n is string => typeof n === "string",
        ))
      : [];

  const { plugin, allDetected } = fingerprintFromNamespaces(namespaces);
  return { ok: true, plugin, allDetected, namespaces };
}
