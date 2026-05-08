-- 0110 -- Add expires_at + last_validated_at to social_connections.
-- Reference: ADR 0003, Build Proposal v2 Week 0 item 0.3.
--
-- Design decisions encoded here:
--
-- 1. Both columns are nullable. expires_at = NULL means no expiry info is
--    available (the connection type may not expire); NOT treated as an error.
--    last_validated_at = NULL means the connection has never been explicitly
--    validated by the cron or webhook.
--
-- 2. expires_at is populated by the webhook handler (primary path) and
--    refreshed by the daily health cron for connections where
--    last_validated_at < NOW() - INTERVAL '24 hours'. See ADR 0003.
--
-- 3. The partial index on expires_at WHERE expires_at IS NOT NULL covers
--    the pre-expiry warning query:
--      WHERE expires_at < NOW() + INTERVAL '7 days'
--        AND expires_at > NOW()
--        AND status = 'healthy'
--    Without this index the query scans the full table. The partial index
--    keeps the index small by excluding NULL rows (not candidates for
--    pre-expiry warnings).
--
-- Write-safety hotspots addressed:
--   - Both columns are pure additions (NULL default); zero risk of breaking
--     existing rows or violating existing constraints.
--   - No triggers, no cascades, no RLS changes -- additive only.

ALTER TABLE social_connections
  ADD COLUMN expires_at        TIMESTAMPTZ NULL,
  ADD COLUMN last_validated_at TIMESTAMPTZ NULL;

-- Partial index for the pre-expiry warning cron query.
CREATE INDEX idx_connections_expires_at
  ON social_connections (expires_at)
  WHERE expires_at IS NOT NULL;

-- Index for the cron's "refresh stale validations" query.
CREATE INDEX idx_connections_last_validated_at
  ON social_connections (last_validated_at)
  WHERE last_validated_at IS NOT NULL;
