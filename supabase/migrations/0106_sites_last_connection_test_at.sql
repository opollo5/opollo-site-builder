-- 0106 — Spec 01 (Sites admin cleanup): track when an operator last ran
-- a successful WP REST connection test against a site.
--
-- Set to now() each time POST /api/sites/[id]/test-connection returns
-- ok=true. Surfaced in the /admin/sites table as "Tested 2h ago" /
-- "Never tested" and used as the secondary sort key (desc, nulls last).
--
-- Replaces the operator-facing "Updated" column on the sites list,
-- which surfaced row mtime — useful for nothing the operator cares about.
-- Forward-only; no backfill (NULL = "never tested" is the correct read).

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS last_connection_test_at timestamptz;

COMMENT ON COLUMN sites.last_connection_test_at IS
  'Set to now() each time POST /api/sites/[id]/test-connection returns ok=true. NULL means the operator has never run a successful connection test against this site (e.g. brand-new pending_pairing rows).';
