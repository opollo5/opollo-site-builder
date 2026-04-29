-- Rollback for 0055_optimiser_page_import.sql.

DROP INDEX IF EXISTS brief_pages_import_idx;
ALTER TABLE brief_pages DROP COLUMN IF EXISTS import_source_url;

ALTER TABLE brief_pages
  DROP CONSTRAINT IF EXISTS brief_pages_mode_check;

ALTER TABLE brief_pages
  ADD CONSTRAINT brief_pages_mode_check CHECK (mode IN (
    'full_text',
    'short_brief'
  ));
