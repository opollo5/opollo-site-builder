-- 0025 — Audit fix: add version_lock to sites.
--
-- Reference: AUDIT triage, 2026-04-27. PR #154 (m13-5c) shipped
-- lib/kadence-palette-sync.ts referencing sites.version_lock for CAS
-- across stampFirstDetection / confirmedPaletteSync / rollbackPalette,
-- but migration 0022 (m13-5a) added kadence_installed_at +
-- kadence_globals_synced_at WITHOUT also folding sites into the
-- version_lock convention. PostgREST therefore returned 42703
-- ("column sites.version_lock does not exist") on every CAS call,
-- which the routes swallowed as a silent INTERNAL_ERROR (500).
--
-- Production impact: zero. Operator clicks on the Appearance panel
-- got an error toast but no WP write happened — the lib aborts at
-- the first SELECT. Verified before this migration via:
--   SELECT id, kadence_installed_at, kadence_globals_synced_at
--   FROM sites WHERE kadence_installed_at IS NOT NULL OR
--   kadence_globals_synced_at IS NOT NULL;  -- 0 rows
--   SELECT site_id, event FROM appearance_events
--   WHERE event IN ('install_completed', 'globals_completed');  -- 0 rows
--
-- Forward-only: sites is otherwise an older table that predates the
-- DATA_CONVENTIONS audit columns. This adds JUST version_lock — the
-- minimum to unblock M13-5 routes. The wider audit/soft-delete fold-in
-- is intentionally deferred (separate slice; sites is the central
-- table and a wider change deserves its own PR).
--
-- Backfill: NOT NULL DEFAULT 1 means existing rows get version_lock=1
-- atomically as part of the ALTER. No data migration required. Any
-- code path that doesn't set the column on UPDATE leaves it at 1
-- forever, which is fine — the only callers that CAS on it are the
-- M13-5 routes (which now work correctly), and any future call sites
-- will read-then-write under CAS.

ALTER TABLE sites
  ADD COLUMN version_lock integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1);

COMMENT ON COLUMN sites.version_lock IS
  'Optimistic concurrency counter per docs/DATA_CONVENTIONS.md. Incremented on every mutating UPDATE through CAS (eq("version_lock", expected) + version_lock: expected+1). Conflict returns 409 / VERSION_CONFLICT. Added 2026-04-27 (audit fix: M13-5c shipped lib code referencing this column without the schema migration).';
