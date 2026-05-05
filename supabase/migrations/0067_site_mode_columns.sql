-- 0067 — Site mode + extracted-design columns.
-- Reference: DESIGN-SYSTEM-OVERHAUL workstream (PR 5/15).
--
-- Foundation schema for the unified setup flow. Each site gets one of
-- two modes:
--
--   copy_existing — site already has a live WordPress theme. The setup
--                   flow extracts the design profile (colours, fonts,
--                   common CSS class names) so generated content
--                   matches without injecting new CSS.
--
--   new_design    — site is being built fresh. The existing
--                   DESIGN-DISCOVERY wizard runs (concepts → tokens →
--                   tone). Generated content includes inline CSS
--                   accumulated into the design system.
--
-- Site mode is captured BEFORE either path runs (see PR 6's
-- /admin/sites/[id]/onboarding screen). NULL = site hasn't been
-- onboarded yet; the existing site detail page will show a banner
-- prompting the operator to pick.
--
-- Design decisions encoded here:
--
-- 1. site_mode as text + CHECK constraint rather than ENUM. Same
--    rationale as opt_clients.hosting_mode (migration 0031): future
--    additions (e.g. 'hybrid') don't require a type ALTER.
--
-- 2. extracted_design + extracted_css_classes as JSONB. Both shapes
--    are iterating during PR 7's extraction work and committing to a
--    columnar shape now would lock us into the v1 cut.
--
-- 3. NULLable site_mode + extracted_* default to NULL. No backfill —
--    existing rows are mid-DESIGN-DISCOVERY and the onboarding banner
--    catches them on the next site detail visit.
--
-- 4. No FK to a separate site_modes lookup table. Two values today
--    (three with the noted future). Lookup table would be ceremony
--    without payback.
--
-- 5. No site_modes UNIQUE / index — site_mode is queried by the
--    site row's PK lookup; no need for a secondary index.
--
-- Write-safety notes:
--   - Pure ALTER TABLE ADD COLUMN with constant defaults / NULLs. No
--     table rewrite; existing rows pick up the new columns lazily.
--   - The CHECK constraint applies only when site_mode is NOT NULL
--     (Postgres CHECK semantics on NULL = pass), so existing rows
--     with NULL pass without re-validation.

ALTER TABLE sites
  ADD COLUMN site_mode text
    CHECK (site_mode IS NULL OR site_mode IN ('copy_existing', 'new_design')),
  ADD COLUMN extracted_design jsonb,
  ADD COLUMN extracted_css_classes jsonb;

COMMENT ON COLUMN sites.site_mode IS
  'Site onboarding mode. NULL = onboarding not yet complete. ''copy_existing'' = site has a live WP theme; setup flow extracts design profile (PR 7). ''new_design'' = built fresh; existing DESIGN-DISCOVERY wizard runs. Added 2026-05-02 (DESIGN-SYSTEM-OVERHAUL PR 5).';

COMMENT ON COLUMN sites.extracted_design IS
  'Extracted design profile for copy_existing sites. Shape (v1): {colors: {primary, secondary, accent, background, text}, fonts: {heading, body}, layout_density, visual_tone, screenshot_url, source_pages}. NULL until extraction runs in PR 7.';

COMMENT ON COLUMN sites.extracted_css_classes IS
  'Common CSS class patterns scraped from the live site. Shape (v1): {container, headings: {h1, h2, h3}, button, card}. Used by mode-aware content generation (PR 10) so produced HTML carries the existing theme''s class names instead of inventing new ones. NULL until extraction runs in PR 7.';
