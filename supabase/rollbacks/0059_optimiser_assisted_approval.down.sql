-- Rollback for 0059_optimiser_assisted_approval.sql
ALTER TABLE opt_clients DROP COLUMN IF EXISTS assisted_approval_enabled;
