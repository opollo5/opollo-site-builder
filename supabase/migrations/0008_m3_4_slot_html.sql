-- M3-4 — Slot-level generated HTML column
--
-- Each batch slot stores the Anthropic-generated HTML here once the
-- generating step finishes. M3-6 reads this when it inserts the
-- pages row for the pre-commit slug claim; M3-8 reads it for the
-- progress UI preview.
--
-- Deliberately separate from pages.generated_html: the slot's HTML
-- is the raw Anthropic output, pages.generated_html is the same
-- content after WP adoption / slug normalisation. Keeping them
-- distinct means a failed WP publish leaves us with a recoverable
-- generation artefact.

ALTER TABLE generation_job_pages
  ADD COLUMN generated_html text;
