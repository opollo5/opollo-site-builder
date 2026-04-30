-- Rollback for 0066_optimiser_clients.sql
DROP POLICY IF EXISTS opt_clients_write ON opt_clients;
DROP POLICY IF EXISTS opt_clients_read ON opt_clients;
DROP POLICY IF EXISTS service_role_all ON opt_clients;
ALTER TABLE IF EXISTS opt_clients DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_clients_onboarded_at_idx;
DROP INDEX IF EXISTS opt_clients_slug_active_uniq;
DROP TABLE IF EXISTS opt_clients;
