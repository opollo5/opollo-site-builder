-- Rollback for 0044_optimiser_client_memory.sql
DROP POLICY IF EXISTS opt_client_memory_write ON opt_client_memory;
DROP POLICY IF EXISTS opt_client_memory_read ON opt_client_memory;
DROP POLICY IF EXISTS service_role_all ON opt_client_memory;
ALTER TABLE IF EXISTS opt_client_memory DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_client_memory_client_type_idx;
DROP INDEX IF EXISTS opt_client_memory_uniq;
DROP TABLE IF EXISTS opt_client_memory;
