import type { WpError } from "./wordpress";

// ---------------------------------------------------------------------------
// M13-2 — operator-friendly translations for the WordPress REST failures
// the post publish path surfaces to the admin UI.
//
// Why this layer exists:
//
// The bare WP response is tuned for WP-API clients ("rest_cannot_create",
// "rest_post_invalid_id", "upload_dir_error"). The M13-4 admin surface
// needs to tell an operator — at 2am, mid-publish — what to DO about
// the failure. That translation doesn't belong inside lib/wordpress.ts
// (which is a pure transport layer) nor in the UI component (which
// should be copy-only). This module is the single source of truth for
// the mapping.
//
// Shape:
//   - Input: a WpError (from lib/wordpress.ts) + optional WP-side code
//     extracted from the response body (`rest_*`).
//   - Output: { title, detail, nextAction } — rendered by
//     PublishFailureBanner / PreflightBlocker in M13-4.
//
// Coverage:
//   - HTTP-level: 401 / 403 / 404 / 429 / 5xx — mapped by the primary
//     error code (AUTH_FAILED / NOT_FOUND / RATE_LIMIT / etc).
//   - WP-level: the `rest_*` codes the post endpoints most often emit —
//     `rest_cannot_create`, `rest_cannot_edit`, `rest_post_invalid_id`,
//     `rest_forbidden`, `rest_invalid_param`, `upload_dir_error`,
//     `invalid_term`, `term_exists`.
//   - Plugin-specific: Yoast / Rank Math / SEOPress meta-write failures
//     are flagged as SEO_PLUGIN_ERROR so the UI can hint at
//     plugin-panel triage.
//
// Unknown codes fall through to a generic "WordPress rejected the
// publish" message with the raw status / code / message exposed in a
// diagnostic details block — enough for an operator to open a bug
// report, not so much that we pretend to understand a code we haven't
// curated.
// ---------------------------------------------------------------------------

export type OperatorTranslation = {
  title: string;
  detail: string;
  nextAction: string;
  /** Tag for UI treatment — banner color, icon, etc. */
  severity: "auth" | "permission" | "not_found" | "validation" | "rate_limit" | "seo" | "upstream" | "network";
};

/**
 * Pick the relevant WP-side code out of a WpError details block. WP's
 * error envelope puts the code at the top level of the JSON response
 * body; our WpError wraps it under `details.wp_response.code`.
 */
export function extractWpRestCode(err: WpError): string | null {
  const wp = (err.details as { wp_response?: { code?: unknown } } | undefined)
    ?.wp_response;
  if (wp && typeof wp === "object" && typeof wp.code === "string") {
    return wp.code;
  }
  return null;
}

// WP-level `rest_*` code → operator translation. Keyed on exact string
// match. Keep this table in step with the WP-core failure modes the
// post path actually emits — aspirational entries belong in a comment
// at the top of the file, not here.
const WP_REST_CODE_TABLE: Record<string, OperatorTranslation> = {
  rest_cannot_create: {
    severity: "permission",
    title: "This WP user can't publish posts",
    detail:
      "The Application Password belongs to a WordPress user whose role lacks the `publish_posts` capability.",
    nextAction:
      "Grant the user an Editor (or Author) role in WordPress, or generate a new Application Password under a user that already has those rights.",
  },
  rest_cannot_edit: {
    severity: "permission",
    title: "This WP user can't edit posts",
    detail:
      "The stored Application Password belongs to a user whose role lacks the `edit_posts` capability.",
    nextAction:
      "Grant the user at least an Author role in WordPress, or re-issue the Application Password under an Editor/Admin account.",
  },
  rest_cannot_delete: {
    severity: "permission",
    title: "This WP user can't delete posts",
    detail:
      "The stored Application Password belongs to a user whose role lacks the `delete_posts` capability.",
    nextAction:
      "Use an Editor or Administrator account for the Application Password, then retry.",
  },
  rest_post_invalid_id: {
    severity: "not_found",
    title: "WordPress no longer has this post",
    detail:
      "The post was deleted in WordPress directly — Opollo still has the record but the WP id is orphaned.",
    nextAction:
      "Reconcile the drift: either restore the post from WP trash, or delete the Opollo record and re-publish a fresh draft.",
  },
  rest_invalid_param: {
    severity: "validation",
    title: "WordPress rejected the post payload",
    detail:
      "One or more fields in the publish request failed WordPress's validation (usually a malformed slug, categories array, or featured_media id).",
    nextAction:
      "Check the slug format, verify the category/tag IDs exist, and confirm the featured media id points to a real attachment.",
  },
  rest_forbidden: {
    severity: "permission",
    title: "WordPress forbade this action",
    detail:
      "WordPress returned a `rest_forbidden` — the user is authenticated but not allowed to perform this specific action.",
    nextAction:
      "Check the WP user's role and any security plugins that may be restricting the REST API.",
  },
  rest_forbidden_context: {
    severity: "permission",
    title: "WordPress forbade `context=edit` for this user",
    detail:
      "Opollo requested the post in `context=edit` mode to read the raw fields; the user's role doesn't allow it.",
    nextAction:
      "Use an Editor (or stronger) account for the Application Password so edit-context reads succeed.",
  },
  upload_dir_error: {
    severity: "upstream",
    title: "WordPress can't write to its uploads directory",
    detail:
      "Featured-media upload failed because WP's `wp-content/uploads` directory isn't writable (permissions, disk full, or hosting-level block).",
    nextAction:
      "Check uploads directory permissions (`chmod`), free disk space, and any host-level write blocks; then retry the publish.",
  },
  invalid_term: {
    severity: "validation",
    title: "A category or tag id wasn't found in WordPress",
    detail:
      "One of the taxonomy IDs in the post payload doesn't correspond to an existing term.",
    nextAction:
      "Re-sync taxonomies against WP (the preflight screen lists every brief-declared term), or remove the invalid id from the post.",
  },
  term_exists: {
    severity: "validation",
    title: "That category or tag already exists",
    detail:
      "Opollo tried to create a new taxonomy term that WordPress already has under a different id.",
    nextAction:
      "Resolve the term via `/wp/v2/categories?slug=...` first, then use the returned id instead of creating.",
  },
  // Plugin-specific bucket. Meta-write failures usually surface as an
  // SEO plugin's own custom code; treat them as a distinct severity so
  // the UI can point at the SEO panel rather than the WP core settings.
  yoast_meta_error: {
    severity: "seo",
    title: "Yoast SEO rejected a meta field",
    detail:
      "Yoast's REST endpoint refused one of the meta fields the brief declared (most commonly `yoast_wpseo_metadesc` length or `yoast_wpseo_focuskw` format).",
    nextAction:
      "Check the Yoast SEO panel in WP for the post to see the specific validation rule that tripped.",
  },
  rank_math_meta_error: {
    severity: "seo",
    title: "Rank Math rejected a meta field",
    detail:
      "Rank Math's REST endpoint refused one of the meta fields the brief declared.",
    nextAction:
      "Check the Rank Math panel in WP for the post to see the specific validation rule.",
  },
};

// HTTP-level translations for when no wp-core `rest_*` code is available
// — the `code` on the WpError envelope is the key.
const WP_HTTP_CODE_TABLE: Record<
  WpError["code"],
  OperatorTranslation
> = {
  AUTH_FAILED: {
    severity: "auth",
    title: "WordPress rejected the Application Password",
    detail:
      "Either the stored Application Password is wrong or Application Passwords are disabled on the WordPress host.",
    nextAction:
      "Re-issue an Application Password for the user in WP → Users → Profile, paste it into the site's settings in Opollo, and retry.",
  },
  UPSTREAM_BLOCKED: {
    severity: "upstream",
    title: "The WordPress host blocked the request",
    detail:
      "The request got a non-JSON 403 — usually a WAF, security plugin, or hosting-level firewall (Cloudflare, Wordfence, SiteGround) dropped it before WordPress saw it.",
    nextAction:
      "Check the host's security / WAF / firewall rules for REST-API blocks, IP allowlisting, or Bot-Fight Mode settings.",
  },
  NOT_FOUND: {
    severity: "not_found",
    title: "WordPress couldn't find that resource",
    detail:
      "The URL path or referenced id doesn't exist on the WordPress side.",
    nextAction:
      "Verify the post / taxonomy / media id exists in WP. If the site was restored from backup, drift reconciliation may be needed.",
  },
  RATE_LIMIT: {
    severity: "rate_limit",
    title: "WordPress is rate-limiting Opollo",
    detail:
      "The host (or a security plugin) is throttling the REST API after too many requests in a short window.",
    nextAction:
      "Back off briefly and retry. If this persists, raise the plugin's threshold or switch to a less aggressive security preset.",
  },
  WP_API_ERROR: {
    severity: "upstream",
    title: "WordPress returned an unexpected error",
    detail:
      "WordPress responded with a non-success status that doesn't match any of the failure modes we've seen before.",
    nextAction:
      "Inspect the diagnostic details below and, if it's reproducible, file a bug so we can add a targeted translation.",
  },
  NETWORK_ERROR: {
    severity: "network",
    title: "Couldn't reach the WordPress host",
    detail:
      "The request didn't complete at the network layer — DNS failure, TLS error, or the host is offline.",
    nextAction:
      "Check that the site URL is correct and reachable, and that DNS + SSL are healthy on the host.",
  },
};

/**
 * Translate a `WpError` into an operator-facing message triple. The
 * WP-level `rest_*` code (if available) takes priority over the HTTP
 * fallback; unknown codes fall through to a generic message that
 * preserves the raw details for diagnosis.
 */
export function translateWpError(err: WpError): OperatorTranslation {
  // Prefer wp-core rest_* code when present — more specific than the
  // HTTP status alone.
  const restCode = extractWpRestCode(err);
  if (restCode) {
    const hit = WP_REST_CODE_TABLE[restCode];
    if (hit) return hit;
  }
  // Fall back to the HTTP-tier translation.
  const httpHit = WP_HTTP_CODE_TABLE[err.code];
  if (httpHit) return httpHit;
  // Last-resort generic.
  return {
    severity: "upstream",
    title: "WordPress rejected the request",
    detail:
      err.message ||
      "WordPress returned an error we haven't seen before. The diagnostic details below contain the raw response.",
    nextAction:
      "If the error is reproducible, file a bug so we can add a targeted translation.",
  };
}
