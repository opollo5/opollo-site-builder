-- 0083 — M16-7: schema additions for the M16 generation pipeline
--
-- Two changes:
--
-- A. pages.wp_page_id nullable
--    The M16 pipeline creates pages rows before WordPress publish.
--    wp_page_id was NOT NULL, blocking pre-publish row creation.
--    Existing rows keep their values; the partial unique index preserves
--    the one-WP-page-per-site guarantee for published pages.
--
-- B. route_registry.ordinal (generation order)
--    The site planner assigns a priority (generation order) to each route.
--    Storing it on route_registry lets the brief-runner map brief_page
--    ordinal → route without substring-matching slugs.

-- ─── A. pages.wp_page_id → nullable ─────────────────────────────────────────

ALTER TABLE pages
  ALTER COLUMN wp_page_id DROP NOT NULL;

ALTER TABLE pages
  DROP CONSTRAINT IF EXISTS unique_wp_page_per_site;

-- Partial unique index: only enforces uniqueness when wp_page_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_site_wp_unique
  ON pages (site_id, wp_page_id)
  WHERE wp_page_id IS NOT NULL;

-- ─── B. route_registry.ordinal ───────────────────────────────────────────────

ALTER TABLE route_registry
  ADD COLUMN IF NOT EXISTS ordinal INT;

-- Index for the brief-runner: find route by (site_id, ordinal)
CREATE INDEX IF NOT EXISTS idx_route_registry_site_ordinal
  ON route_registry (site_id, ordinal)
  WHERE ordinal IS NOT NULL;
