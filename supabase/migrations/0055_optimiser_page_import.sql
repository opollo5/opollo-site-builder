-- 0055 — OPTIMISER PHASE 1.5 SLICE 17: page import via brief_shape='import'.
--
-- Two schema additions:
--
--   1. brief_pages.mode CHECK extended with 'import'. The import mode
--      tells the brief-runner to treat source_text as a serialised
--      source-page payload (URL + HTML snapshot) and reproduce it in
--      Site-Builder-native form using the client's site_conventions.
--      Visual review compares the rendered result against the source
--      screenshot.
--
--   2. brief_pages.import_source_url — when mode='import', records the
--      live URL the source HTML was fetched from. Lets a future side-
--      by-side review surface re-fetch (or re-screenshot) the source
--      independently of the snapshot cached in source_text.
--
-- The brief-runner consumer of mode='import' is intentionally NOT in
-- this slice — it requires extending the existing 94KB runner with a
-- new prompt template and visual-diff step. Slice 17 ships the
-- libraries + schema; the runner integration is a follow-up sub-slice.

ALTER TABLE brief_pages
  DROP CONSTRAINT IF EXISTS brief_pages_mode_check;

ALTER TABLE brief_pages
  ADD CONSTRAINT brief_pages_mode_check CHECK (mode IN (
    'full_text',
    'short_brief',
    'import'
  ));

ALTER TABLE brief_pages
  ADD COLUMN import_source_url text;

CREATE INDEX brief_pages_import_idx
  ON brief_pages (brief_id)
  WHERE mode = 'import' AND deleted_at IS NULL;

COMMENT ON COLUMN brief_pages.mode IS
  'full_text: complete source section; short_brief: summary snippet; import: source HTML payload to reproduce in Site-Builder-native form. `import` added 2026-04-30 (OPTIMISER-17).';

COMMENT ON COLUMN brief_pages.import_source_url IS
  'When mode=import, the live URL the source HTML was fetched from. NULL for other modes. Lets the side-by-side review re-fetch the source independently of the cached snapshot. Added 2026-04-30 (OPTIMISER-17).';
