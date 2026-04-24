-- 0021 — M13-3 briefs.content_type axis.
-- Reference: docs/plans/m13-parent.md §M13-3.
--
-- Additive-only ALTER TABLE. Single column on briefs with CHECK
-- constraint + default 'page' so existing M12-1/M12-2/M12-3/M12-4
-- briefs fold in unchanged. The runner's `mode` parameter reads this
-- column; 'page' preserves existing behavior (anchor cycle on ordinal 0,
-- standard quality gates), 'post' disables the anchor cycle and runs
-- the post-specific quality gates.
--
-- Why a CHECK-constrained text column (not a PG enum):
--   docs/DATA_CONVENTIONS.md §Naming. CHECK constraints rewrite in one
--   ALTER when the enum grows (e.g. future 'product', 'case-study' —
--   tracked in parent plan §Out of scope). A Postgres ENUM type would
--   need ALTER TYPE ... ADD VALUE which is not transaction-safe.
--
-- Default = 'page' is the safe migration — every row on main right now
-- is a page brief; no backfill needed. Post briefs will be inserted
-- with content_type='post' explicitly by the M13-4 upload route.
--
-- Write-safety hotspots addressed:
--   - CHECK IN ('page','post') — rejects unknown values at the schema
--     layer, so an ops-layer patch or backfill bug can't slip a value
--     the runner's dispatch table doesn't know how to handle.
--   - NOT NULL + DEFAULT — existing briefs have a legal value without
--     a data-migration pass; new inserts that forget the column get
--     the safe default.

ALTER TABLE briefs
  ADD COLUMN content_type text NOT NULL DEFAULT 'page'
    CHECK (content_type IN ('page', 'post'));

-- Partial index on the post subset — the M13-4 admin surface will
-- filter "post briefs for this site" frequently; page briefs
-- dominate today, so a full (site_id, content_type) index would
-- balloon for a predicate the query planner hits rarely.
CREATE INDEX idx_briefs_site_post_content_type
  ON briefs (site_id, created_at DESC)
  WHERE content_type = 'post' AND deleted_at IS NULL;
