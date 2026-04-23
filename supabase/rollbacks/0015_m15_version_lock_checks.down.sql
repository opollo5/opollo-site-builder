-- Rollback for 0015_m15_version_lock_checks.sql

ALTER TABLE image_library
  DROP CONSTRAINT IF EXISTS image_library_version_lock_positive;

ALTER TABLE briefs
  DROP CONSTRAINT IF EXISTS briefs_version_lock_positive;

ALTER TABLE brief_pages
  DROP CONSTRAINT IF EXISTS brief_pages_version_lock_positive;

ALTER TABLE brief_runs
  DROP CONSTRAINT IF EXISTS brief_runs_version_lock_positive;

ALTER TABLE site_conventions
  DROP CONSTRAINT IF EXISTS site_conventions_version_lock_positive;
