-- 0052 — OPTIMISER PHASE 1.5 SLICE 14: full_page output mode foundations.
--
-- Four schema additions, one per surface:
--
--   1. brief_pages.output_mode  — routes brief-runner between the
--      existing slice-mode fragment composition (default) and the new
--      full_page composition that produces a complete standalone HTML
--      document with `<html>/<head>/<body>` chrome, tracking pixels,
--      and bundled assets.
--
--   2. site_conventions.full_page_chrome — JSONB payload caching the
--      header / footer / nav HTML extracted from the client's live
--      homepage. Populated lazily on first full_page generation when
--      the client previously only had slice-mode pages, so subsequent
--      runs skip the homepage fetch + extraction step.
--
--   3. opt_change_log.dry_run_payload — JSONB capture of the would-be
--      static-file write target + body when SiteGround SFTP credentials
--      aren't provisioned. Lets Phase 1.5 ship + be tested before the
--      hosting credentials land in env vars; flips to NULL on real
--      writes.
--
--   4. opt_clients.tracking_config — JSONB per-client GA4 + Google Ads
--      tracking config. Optimiser writes the matching pixels into the
--      <head> of full_page output. Empty object = no pixels injected.
--
-- Forward-only. The new columns are nullable (or default to safe
-- empty values) so existing rows don't need backfill.

-- 1. brief_pages.output_mode
ALTER TABLE brief_pages
  ADD COLUMN output_mode text NOT NULL DEFAULT 'slice'
    CHECK (output_mode IN ('slice', 'full_page'));

COMMENT ON COLUMN brief_pages.output_mode IS
  '"slice" (default) → existing fragment composition; brief-runner outputs <section> blocks for the WordPress connector to wrap with theme chrome. "full_page" → full standalone HTML document, written to the static hosting target. Added 2026-04-30 (OPTIMISER-14).';

-- 2. site_conventions.full_page_chrome
ALTER TABLE site_conventions
  ADD COLUMN full_page_chrome jsonb;

COMMENT ON COLUMN site_conventions.full_page_chrome IS
  'Header / footer / nav HTML extracted from the client''s live homepage on first full_page generation. Shape: { header_html: text, footer_html: text, nav_html: text, source_url: text, extracted_at: iso8601 }. NULL until the lazy extraction runs; subsequent full_page generations re-use the cached extraction. Re-extraction is manual (clear the column) — homepage redesigns are rare. Added 2026-04-30 (OPTIMISER-14).';

-- 3. opt_change_log.dry_run_payload
ALTER TABLE opt_change_log
  ADD COLUMN dry_run_payload jsonb;

COMMENT ON COLUMN opt_change_log.dry_run_payload IS
  'When the static-file write step runs without provisioned hosting credentials, it captures the intended write here (target_path, body_size, body_sha256, would_have_archived_to). Real writes leave this NULL. Added 2026-04-30 (OPTIMISER-14).';

-- 4. opt_clients.tracking_config
ALTER TABLE opt_clients
  ADD COLUMN tracking_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN opt_clients.tracking_config IS
  'Per-client tracking pixel config. Optimiser injects matching <script> + <noscript> blocks into full_page <head>. Recognised keys: ga4_measurement_id (text, e.g. G-XXXXXXX), google_ads_conversion_id (text, e.g. AW-123456789), google_ads_conversion_label (text). Empty object = no pixels injected. Added 2026-04-30 (OPTIMISER-14).';
