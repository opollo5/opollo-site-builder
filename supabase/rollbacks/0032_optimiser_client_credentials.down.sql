-- Rollback for 0032_optimiser_client_credentials.sql
DROP POLICY IF EXISTS service_role_all ON opt_client_credentials;
ALTER TABLE IF EXISTS opt_client_credentials DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_client_credentials_status_idx;
DROP INDEX IF EXISTS opt_client_credentials_client_source_uniq;
DROP TABLE IF EXISTS opt_client_credentials;
