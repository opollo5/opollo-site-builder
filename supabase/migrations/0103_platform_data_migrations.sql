-- =============================================================================
-- 0103 — platform_data_migrations audit table.
--
-- Tracks manual data migrations (e.g. orphaned-asset assignment, bulk
-- company_id backfills) so there is a permanent audit trail of who ran
-- what and how many rows were affected.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_data_migrations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name text      NOT NULL,
  table_name   text        NOT NULL,
  records_affected integer NOT NULL,
  executed_by  uuid        REFERENCES platform_users(id) ON DELETE SET NULL,
  executed_at  timestamptz NOT NULL DEFAULT now(),
  notes        jsonb
);

CREATE INDEX idx_data_migrations_name ON platform_data_migrations(migration_name);
CREATE INDEX idx_data_migrations_executed_at ON platform_data_migrations(executed_at DESC);

-- RLS — Opollo staff only (these are internal ops records)
ALTER TABLE platform_data_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_migrations_staff_only ON platform_data_migrations FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());
