-- Rollback for 0022 — drops appearance schema.

DROP TABLE IF EXISTS appearance_events;

ALTER TABLE sites
  DROP COLUMN IF EXISTS kadence_globals_synced_at,
  DROP COLUMN IF EXISTS kadence_installed_at;
