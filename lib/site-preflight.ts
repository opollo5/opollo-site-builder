import "server-only";

import { logger } from "@/lib/logger";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";
import { translateWpError } from "@/lib/error-translations";
import {
  wpGetMe,
  type WpConfig,
  type WpError,
  type WpUserCapabilities,
} from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-4 — publish-time preflight for posts.
//
// Runs before the operator clicks "Publish" on a post. Surfaces the two
// WP-side blockers the parent plan flagged as load-bearing:
//
//   - auth-capability-missing: stored app password can't edit_posts
//     and/or upload_files. The operator sees a translated message +
//     a link to the WP user role docs, not a raw 401 post-publish.
//
//   - rest-disabled or rest-unreachable: /wp-json/wp/v2/users/me
//     returned a 404 / 5xx / network error. Distinguishes "WP REST
//     is off" from "your login doesn't have the capability" so the
//     operator's next action is correct.
//
// Why a dedicated lib rather than inlining into the publish route:
//   1. The publish route is a mutation path; the preflight is a read-
//      only GET against /users/me. Separating keeps the mutation
//      route small and the preflight auditable + testable in
//      isolation.
//   2. The run surface (M13-4) calls preflight BEFORE rendering the
//      publish button — if the site is unreachable, the button is
//      disabled with a translated blocker instead of tempting the
//      operator into a failing click.
//
// Out of scope (parent plan §assistive-operator-flow, still tracked):
//   - Featured-media capability check (only relevant when the site's
//     theme/SEO plugin mandates a featured image — surfaced at the
//     quality-gate layer in M13-3).
//   - Category/taxonomy whitelist preflight (deferred to M13-5 once
//     the brief declares taxonomies).
// ---------------------------------------------------------------------------

export const REQUIRED_PUBLISH_CAPABILITIES = [
  "edit_posts",
  "upload_files",
] as const;

export type PreflightBlocker = {
  // Short identifier for the UI to switch on; mirrors the parent plan's
  // "three blockers" list, plus Spec 03's BLOG_STYLE_NOT_CALIBRATED.
  code:
    | "AUTH_CAPABILITY_MISSING"
    | "REST_UNREACHABLE"
    | "REST_AUTH_FAILED"
    | "SITE_CONFIG_MISSING"
    | "BLOG_STYLE_NOT_CALIBRATED";
  title: string;
  detail: string;
  nextAction: string;
  /** Specific capabilities missing when code is AUTH_CAPABILITY_MISSING. */
  missing_capabilities?: string[];
  /** Optional href the UI's "Action" button should link to. */
  actionHref?: string;
};

export type PreflightResult =
  | {
      ok: true;
      user_id: number;
      username: string;
      capabilities: WpUserCapabilities;
    }
  | { ok: false; blocker: PreflightBlocker };

/**
 * Run the publish preflight for a site. Reads stored WP credentials,
 * hits /wp-json/wp/v2/users/me, and returns either the user's
 * capabilities (for UI display + follow-up gate checks) or a typed
 * blocker the UI can render directly.
 *
 * No side effects. Safe to call on every render of the publish-button
 * neighborhood; operators can re-run it freely.
 */
export async function preflightSitePublish(
  site_id: string,
): Promise<PreflightResult> {
  const siteRes = await getSite(site_id, { includeCredentials: true });
  if (!siteRes.ok) {
    return {
      ok: false,
      blocker: {
        code: "SITE_CONFIG_MISSING",
        title: "This site doesn't have WordPress credentials yet.",
        detail:
          siteRes.error.message ??
          "We can't publish without a stored WP URL + app password.",
        nextAction:
          "Open the site settings and add WP credentials, then re-run preflight.",
      },
    };
  }
  const site = siteRes.data.site as { wp_url: string };
  const creds = siteRes.data.credentials;
  if (!creds) {
    return {
      ok: false,
      blocker: {
        code: "SITE_CONFIG_MISSING",
        title: "This site doesn't have WordPress credentials yet.",
        detail: "The site exists but has no stored app password.",
        nextAction:
          "Open the site settings and add WP credentials, then re-run preflight.",
      },
    };
  }
  const cfg: WpConfig = {
    baseUrl: site.wp_url,
    user: creds.wp_user,
    appPassword: creds.wp_app_password,
  };

  const meRes = await wpGetMe(cfg);
  if (!meRes.ok) {
    return translateWpErrorToBlocker(meRes);
  }

  const missing = REQUIRED_PUBLISH_CAPABILITIES.filter(
    (cap) => !meRes.capabilities[cap],
  );
  if (missing.length > 0) {
    return {
      ok: false,
      blocker: {
        code: "AUTH_CAPABILITY_MISSING",
        title: "This WordPress login can't publish posts.",
        detail: `The stored app password is missing required capabilities: ${missing.join(", ")}. Publishing a post needs at least 'edit_posts' and 'upload_files'.`,
        nextAction:
          "In WP Admin → Users, give this account the Editor role (or higher), then regenerate the app password and update it in Opollo's site settings.",
        missing_capabilities: missing,
      },
    };
  }

  return {
    ok: true,
    user_id: meRes.user_id,
    username: meRes.username,
    capabilities: meRes.capabilities,
  };
}

function translateWpErrorToBlocker(
  err: WpError,
): { ok: false; blocker: PreflightBlocker } {
  const translated = translateWpError(err);

  // Map the WpError.code → PreflightBlocker.code. HTTP 404 on /users/me
  // means REST is almost certainly disabled (or the path is blocked by
  // a security plugin); 401/403 is auth.
  if (err.code === "AUTH_FAILED") {
    return {
      ok: false,
      blocker: {
        code: "REST_AUTH_FAILED",
        title: translated.title,
        detail: translated.detail,
        nextAction: translated.nextAction,
      },
    };
  }
  if (err.code === "NOT_FOUND") {
    return {
      ok: false,
      blocker: {
        code: "REST_UNREACHABLE",
        title: "WordPress REST is unreachable.",
        detail:
          "The /wp-json/wp/v2/users/me endpoint returned 404. This usually means REST is disabled by a security plugin or a .htaccess rule.",
        nextAction:
          "In WP Admin → Plugins, disable anything that blocks REST (iThemes Security, WP Hide, etc.), then re-run preflight.",
      },
    };
  }

  // Network / 5xx / unknown — fall through to the generic REST-unreachable
  // treatment with the translated detail string.
  logger.warn("preflight.wp_me_failed", {
    code: err.code,
    message: err.message,
  });
  return {
    ok: false,
    blocker: {
      code: "REST_UNREACHABLE",
      title: translated.title,
      detail: translated.detail,
      nextAction: translated.nextAction,
    },
  };
}

// ---------------------------------------------------------------------------
// Spec 03 — blog-styling calibration gate for copy_existing sites.
//
// Fires when ALL of:
//   1. content_type === 'post'
//   2. site_mode === 'copy_existing'
//   3. extracted_design.blog_styling is null OR has zero source_blog_urls
//
// Does NOT fire for new_design (Kadence sync owns blog styling there),
// for site_mode=null (the onboarding banner handles unconfigured sites),
// or for content_type='page' (page generation unaffected by blog styling).
//
// Returns null when the blocker doesn't apply, or a typed PreflightBlocker
// that callers can render alongside other preflight failures (UIs MAY
// see both BLOG_STYLE_NOT_CALIBRATED and REST_AUTH_FAILED simultaneously
// per the spec — render both).
// ---------------------------------------------------------------------------

export async function checkBlogStylingCalibrated(
  site_id: string,
  content_type: "post" | "page",
): Promise<PreflightBlocker | null> {
  if (content_type !== "post") return null;

  const svc = getServiceRoleClient();
  const res = await svc
    .from("sites")
    .select("site_mode, extracted_design")
    .eq("id", site_id)
    .maybeSingle();

  if (res.error) {
    logger.error("site_preflight.blog_styling_check_failed", {
      site_id,
      error: res.error,
    });
    // Fail open — don't synthesise a blocker on a DB read error.
    return null;
  }

  const row = res.data as {
    site_mode: string | null;
    extracted_design: unknown;
  } | null;

  if (!row || row.site_mode !== "copy_existing") return null;

  const extracted = row.extracted_design;
  const blogStyling =
    extracted && typeof extracted === "object" && extracted !== null
      ? (extracted as { blog_styling?: { source_blog_urls?: unknown } }).blog_styling
      : null;
  const sourceUrls =
    blogStyling && typeof blogStyling === "object"
      ? (blogStyling as { source_blog_urls?: unknown }).source_blog_urls
      : undefined;
  const calibrated =
    blogStyling !== null &&
    blogStyling !== undefined &&
    Array.isArray(sourceUrls) &&
    sourceUrls.length > 0;

  if (calibrated) return null;

  return {
    code: "BLOG_STYLE_NOT_CALIBRATED",
    title: "Blog styling not calibrated",
    detail:
      'This site is in "copy existing" mode, but we haven\'t learned how its blog posts are styled yet. Generated blog posts may not match your site\'s design.',
    nextAction: "Calibrate blog styling →",
    actionHref: `/admin/sites/${site_id}/setup/extract?focus=blog-styling`,
  };
}

// NOTE: bulk-blog-upload surface (if added later) must respect this blocker
// per Spec 03 §2.5 — call checkBlogStylingCalibrated() at the site-picker
// step and disable the file-drop / paste interface when it returns
// non-null.

// ---------------------------------------------------------------------------
// Path-B publish gate — Kadence sync freshness check.
//
// Gated by FEATURE_PATH_B_PUBLISH_GATE env var (default off).
// Only applies to new_design sites — copy_existing sites don't use
// Kadence palette sync so the check is a no-op for them.
//
// Blocks publish when:
//   - flag is on
//   - site_mode === 'new_design'
//   - kadence_globals_synced_at IS NULL (never synced)
//
// Callers receive a typed result; the 409 KADENCE_SYNC_DRIFT_BLOCKED
// response code is defined here so all publish-path routes use the
// same wire format.
// ---------------------------------------------------------------------------

export type KadenceSyncCheckResult =
  | { blocked: false }
  | {
      blocked: true;
      code: "KADENCE_SYNC_DRIFT_BLOCKED";
      message: string;
      appearanceUrl: string;
    };

export async function checkKadenceSyncFresh(
  site_id: string,
): Promise<KadenceSyncCheckResult> {
  const flag = process.env.FEATURE_PATH_B_PUBLISH_GATE;
  if (flag !== "true" && flag !== "1") return { blocked: false };

  const svc = getServiceRoleClient();
  const res = await svc
    .from("sites")
    .select("site_mode, kadence_globals_synced_at")
    .eq("id", site_id)
    .maybeSingle();

  if (res.error) {
    logger.error("site_preflight.kadence_sync_check_failed", {
      site_id,
      error: res.error,
    });
    // Fail open — don't block publish on a DB read error.
    return { blocked: false };
  }

  const row = res.data as {
    site_mode: string | null;
    kadence_globals_synced_at: string | null;
  } | null;

  if (!row || row.site_mode !== "new_design") return { blocked: false };
  if (row.kadence_globals_synced_at !== null) return { blocked: false };

  return {
    blocked: true,
    code: "KADENCE_SYNC_DRIFT_BLOCKED",
    message:
      "Palette not yet synced. Run palette sync in the Appearance panel before publishing.",
    appearanceUrl: `/admin/sites/${site_id}/appearance`,
  };
}
