-- Rollback for 0006_m2c_revoked_at.sql
ALTER TABLE opollo_users DROP COLUMN IF EXISTS revoked_at;
