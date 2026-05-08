-- Rollback for 0110_social_connections_expiry.sql
-- Drops the indexes and columns added by the forward migration.
-- Does NOT restore data â€” any expires_at / last_validated_at values are lost.
-- Intended for local dev / CI reset, not production recovery.

DROP INDEX IF EXISTS idx_connections_last_validated_at;
DROP INDEX IF EXISTS idx_connections_expires_at;

ALTER TABLE social_connections
  DROP COLUMN IF EXISTS last_validated_at,
  DROP COLUMN IF EXISTS expires_at;

