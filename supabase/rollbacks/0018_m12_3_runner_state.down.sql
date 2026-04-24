-- Rollback for 0018. Drops the M12-3 runner-state columns.
--
-- Data loss: any in-flight runs lose their current_pass_kind /
-- current_pass_number pointers. Approved pages lose generated_html
-- (but published WP pages are unaffected — the DB copy of the HTML
-- goes).
--
-- Run only on environments where:
--   (a) no brief_runs rows are in a non-terminal status, OR
--   (b) the work-in-flight state is expendable.

ALTER TABLE brief_runs
  DROP COLUMN IF EXISTS content_summary;

ALTER TABLE brief_pages
  DROP CONSTRAINT IF EXISTS brief_pages_generated_html_coherent;

ALTER TABLE brief_pages
  DROP CONSTRAINT IF EXISTS brief_pages_approved_coherent;

ALTER TABLE brief_pages
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS critique_log,
  DROP COLUMN IF EXISTS generated_html,
  DROP COLUMN IF EXISTS draft_html,
  DROP COLUMN IF EXISTS current_pass_number,
  DROP COLUMN IF EXISTS current_pass_kind,
  DROP COLUMN IF EXISTS page_status;
