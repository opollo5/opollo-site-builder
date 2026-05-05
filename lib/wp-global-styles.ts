import "server-only";

// ---------------------------------------------------------------------------
// lib/wp-global-styles.ts
//
// M16-8 — WordPress Global Styles (theme.json) push.
//
// Compiles site_blueprints.design_tokens into a partial theme.json
// and PATCH-pushes it to the WP Global Styles API.
//
// Only Opollo-managed keys are written:
//   settings.color.palette   — primary, secondary, accent, background, text
//   settings.typography.fontSizes — heading, body
//   settings.spacing          — spacingScale (unit only)
//
// The WP Global Styles endpoint merges the patch so keys we don't send
// are left untouched.  Risk 9 in docs/plans/m16-parent.md.
//
// Requires the active theme to support FSE (theme.json).
// Silently succeeds with `ok: true, skipped: true` when the theme does
// not expose the Global Styles REST endpoint (classic themes, Kadence < 3).
// ---------------------------------------------------------------------------

import type { WpConfig } from "@/lib/wordpress";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OpolloDesignTokens = {
  primary?:      string;
  secondary?:    string;
  accent?:       string;
  background?:   string;
  text?:         string;
  font_heading?: string;
  font_body?:    string;
  border_radius?: string;
  spacing_unit?: string;
};

export type WpColorPaletteEntry = {
  slug:  string;
  color: string;
  name:  string;
};

export type WpFontSizeEntry = {
  slug:  string;
  size:  string;
  name:  string;
};

export type WpThemeJsonPatch = {
  settings: {
    color:       { palette: { theme: WpColorPaletteEntry[] } };
    typography?: { fontSizes?: { theme: WpFontSizeEntry[] } };
    spacing?:    { spacingScale?: { unit: string; steps: number; operator: string } };
  };
};

export type PublishThemeResult =
  | { ok: true; globalStylesId: number; skipped?: never }
  | { ok: true; skipped: true; globalStylesId?: never }
  | { ok: false; code: string; message: string; retryable: boolean };

// ─── Compile ─────────────────────────────────────────────────────────────────

/**
 * Converts Opollo design_tokens into a partial theme.json patch.
 * Returns only the Opollo-managed keys — no other settings are touched.
 */
export function compileThemeJsonPatch(
  tokens: OpolloDesignTokens,
): WpThemeJsonPatch {
  const palette: WpColorPaletteEntry[] = [];

  const colorEntries: [keyof OpolloDesignTokens, string, string][] = [
    ["primary",    "opollo-primary",    "Primary"],
    ["secondary",  "opollo-secondary",  "Secondary"],
    ["accent",     "opollo-accent",     "Accent"],
    ["background", "opollo-background", "Background"],
    ["text",       "opollo-text",       "Text"],
  ];

  for (const [key, slug, name] of colorEntries) {
    const val = tokens[key];
    if (typeof val === "string" && val.startsWith("#")) {
      palette.push({ slug, color: val, name });
    }
  }

  const patch: WpThemeJsonPatch = {
    settings: {
      color: { palette: { theme: palette } },
    },
  };

  const fontSizes: WpFontSizeEntry[] = [];
  if (typeof tokens.font_heading === "string" && tokens.font_heading) {
    fontSizes.push({ slug: "opollo-heading", size: "1.25rem", name: `Heading (${tokens.font_heading})` });
  }
  if (typeof tokens.font_body === "string" && tokens.font_body) {
    fontSizes.push({ slug: "opollo-body", size: "1rem", name: `Body (${tokens.font_body})` });
  }
  if (fontSizes.length > 0) {
    patch.settings.typography = { fontSizes: { theme: fontSizes } };
  }

  if (typeof tokens.spacing_unit === "string" && tokens.spacing_unit) {
    patch.settings.spacing = {
      spacingScale: { unit: tokens.spacing_unit, steps: 6, operator: "*" },
    };
  }

  return patch;
}

// ─── WordPress API ────────────────────────────────────────────────────────────

function authHeader(cfg: WpConfig): string {
  return `Basic ${Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64")}`;
}

async function wpJsonFetch(
  cfg: WpConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: authHeader(cfg),
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };
  return fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
}

/** Gets the active theme slug via GET /wp-json/wp/v2/themes?status=active */
async function getActiveThemeSlug(
  cfg: WpConfig,
): Promise<{ ok: true; slug: string } | { ok: false; code: string; message: string }> {
  let res: Response;
  try {
    res = await wpJsonFetch(cfg, "/wp-json/wp/v2/themes?status=active&_fields=stylesheet", { method: "GET" });
  } catch (err) {
    return { ok: false, code: "NETWORK_ERROR", message: String(err) };
  }
  if (res.status === 404 || res.status === 403) {
    return { ok: false, code: "THEMES_ENDPOINT_UNAVAILABLE", message: `WP themes endpoint returned ${res.status}` };
  }
  if (!res.ok) {
    return { ok: false, code: "WP_API_ERROR", message: `WP themes returned ${res.status}` };
  }
  let body: { stylesheet?: string }[];
  try {
    body = await res.json() as { stylesheet?: string }[];
  } catch {
    return { ok: false, code: "PARSE_ERROR", message: "Failed to parse themes response" };
  }
  const slug = body[0]?.stylesheet;
  if (!slug) return { ok: false, code: "NO_ACTIVE_THEME", message: "No active theme found" };
  return { ok: true, slug };
}

/** Gets the Global Styles post ID for the active theme */
async function getGlobalStylesId(
  cfg: WpConfig,
  themeSlug: string,
): Promise<{ ok: true; id: number } | { ok: false; code: string; message: string; retryable: boolean }> {
  let res: Response;
  try {
    res = await wpJsonFetch(
      cfg,
      `/wp-json/wp/v2/global-styles/themes/${encodeURIComponent(themeSlug)}`,
      { method: "GET" },
    );
  } catch (err) {
    return { ok: false, code: "NETWORK_ERROR", message: String(err), retryable: true };
  }
  if (res.status === 404) {
    return { ok: false, code: "GLOBAL_STYLES_NOT_FOUND", message: `No global styles for theme '${themeSlug}'`, retryable: false };
  }
  if (!res.ok) {
    return { ok: false, code: "WP_API_ERROR", message: `WP global-styles returned ${res.status}`, retryable: res.status >= 500 };
  }
  let body: { id?: unknown };
  try {
    body = await res.json() as { id?: unknown };
  } catch {
    return { ok: false, code: "PARSE_ERROR", message: "Failed to parse global-styles response", retryable: false };
  }
  const id = Number(body.id);
  if (!id) return { ok: false, code: "NO_ID", message: "Global styles response missing id", retryable: false };
  return { ok: true, id };
}

/** PATCH the WP Global Styles with an Opollo-only theme.json patch */
async function patchGlobalStyles(
  cfg: WpConfig,
  id: number,
  patch: WpThemeJsonPatch,
): Promise<{ ok: true; id: number } | { ok: false; code: string; message: string; retryable: boolean }> {
  let res: Response;
  try {
    res = await wpJsonFetch(cfg, `/wp-json/wp/v2/global-styles/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  } catch (err) {
    return { ok: false, code: "NETWORK_ERROR", message: String(err), retryable: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, code: "WP_API_ERROR", message: `WP global-styles PUT returned ${res.status}: ${text.slice(0, 200)}`, retryable: res.status >= 500 };
  }
  return { ok: true, id };
}

/**
 * High-level: compiles design_tokens and pushes to WP Global Styles.
 * Returns `{ ok: true, skipped: true }` when the WP theme does not
 * support Global Styles (classic theme or old Kadence version).
 */
export async function publishThemeTokens(
  cfg: WpConfig,
  tokens: OpolloDesignTokens,
): Promise<PublishThemeResult> {
  const patch = compileThemeJsonPatch(tokens);

  // Empty palette = nothing to push
  if (patch.settings.color.palette.theme.length === 0) {
    return { ok: true, skipped: true };
  }

  const themeRes = await getActiveThemeSlug(cfg);
  if (!themeRes.ok) {
    if (themeRes.code === "THEMES_ENDPOINT_UNAVAILABLE") {
      return { ok: true, skipped: true };
    }
    return { ok: false, code: themeRes.code, message: themeRes.message, retryable: false };
  }

  const idRes = await getGlobalStylesId(cfg, themeRes.slug);
  if (!idRes.ok) {
    if (idRes.code === "GLOBAL_STYLES_NOT_FOUND") {
      return { ok: true, skipped: true };
    }
    return idRes;
  }

  const patchRes = await patchGlobalStyles(cfg, idRes.id, patch);
  if (!patchRes.ok) return patchRes;

  return { ok: true, globalStylesId: patchRes.id };
}
