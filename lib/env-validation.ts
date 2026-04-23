import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// M15-3 — env coupling validation at boot.
//
// Surfaces three classes of silent-misconfig from the env audit:
//   1. LEADSOURCE_WP_URL and NEXT_PUBLIC_LEADSOURCE_WP_URL must agree.
//      Mismatch silently breaks CSP connect-src / preview iframe.
//   2. NEXT_PUBLIC_SITE_URL must be set to a https:// origin on Vercel
//      production. Unset = auth redirects fall back to Host header
//      (spoof-vulnerable); http:// = Supabase rejects redirect links.
//   3. CLOUDFLARE_IMAGES_HASH must be set when Cloudflare Images creds
//      are set. Absent hash produces malformed delivery URLs that 404
//      silently.
//
// Warnings only — the app does not crash. These states can be deliberate
// in dev / preview (no WP integration configured, etc.) and we don't
// want boot to fail on a preview deploy.
// ---------------------------------------------------------------------------

let alreadyValidated = false;

export function validateEnvCouplingOnce(): void {
  if (alreadyValidated) return;
  alreadyValidated = true;
  validateEnvCoupling();
}

export function validateEnvCoupling(): void {
  const isProd = process.env.VERCEL_ENV === "production";

  checkLeadSourceWpUrlCoupling();
  checkNextPublicSiteUrl(isProd);
  checkCloudflareImagesHash();
}

function checkLeadSourceWpUrlCoupling(): void {
  const server = process.env.LEADSOURCE_WP_URL ?? "";
  const client = process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL ?? "";

  if (!server && !client) return;

  if (server && !client) {
    logger.warn("env_coupling_warning", {
      check: "leadsource_wp_url",
      issue: "server_set_client_missing",
      detail:
        "LEADSOURCE_WP_URL is set but NEXT_PUBLIC_LEADSOURCE_WP_URL is not. The client-side preview iframe will be blank until both are set and matching.",
    });
    return;
  }

  if (!server && client) {
    logger.warn("env_coupling_warning", {
      check: "leadsource_wp_url",
      issue: "client_set_server_missing",
      detail:
        "NEXT_PUBLIC_LEADSOURCE_WP_URL is set but LEADSOURCE_WP_URL is not. Server-side WP publish will fail.",
    });
    return;
  }

  if (server !== client) {
    logger.warn("env_coupling_warning", {
      check: "leadsource_wp_url",
      issue: "server_client_mismatch",
      server,
      client,
      detail:
        "LEADSOURCE_WP_URL and NEXT_PUBLIC_LEADSOURCE_WP_URL disagree. CSP connect-src and preview iframe point at different origins; one of them is wrong.",
    });
  }
}

function checkNextPublicSiteUrl(isProd: boolean): void {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  if (isProd && !siteUrl) {
    logger.warn("env_coupling_warning", {
      check: "next_public_site_url",
      issue: "unset_in_production",
      detail:
        "NEXT_PUBLIC_SITE_URL is not set on a production deploy. Auth email redirects will fall back to the request Host header, which is spoof-vulnerable. Set it to the production origin (e.g. https://opollo.vercel.app) and register the same value in Supabase Dashboard → Authentication → Redirect URLs allowlist.",
    });
    return;
  }

  if (isProd && siteUrl && !siteUrl.startsWith("https://")) {
    logger.warn("env_coupling_warning", {
      check: "next_public_site_url",
      issue: "non_https_in_production",
      value: siteUrl,
      detail:
        "NEXT_PUBLIC_SITE_URL does not start with https:// on a production deploy. Supabase rejects non-HTTPS redirect URLs in production.",
    });
  }
}

function checkCloudflareImagesHash(): void {
  const hash = process.env.CLOUDFLARE_IMAGES_HASH ?? "";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN ?? "";

  if (!hash && (accountId || apiToken)) {
    logger.warn("env_coupling_warning", {
      check: "cloudflare_images_hash",
      issue: "hash_missing_while_configured",
      detail:
        "CLOUDFLARE_IMAGES_HASH is unset but Cloudflare Images credentials are configured. Delivery URLs will be malformed (https://imagedelivery.net//<id>/public) and 404. Set CLOUDFLARE_IMAGES_HASH from Cloudflare Dashboard → Images → Variants.",
    });
  }
}

export function __resetValidationForTests(): void {
  alreadyValidated = false;
}
