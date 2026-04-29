-- Rollback for 0040_optimiser_playbooks.sql
DROP POLICY IF EXISTS opt_playbooks_write ON opt_playbooks;
DROP POLICY IF EXISTS opt_playbooks_read ON opt_playbooks;
DROP POLICY IF EXISTS service_role_all ON opt_playbooks;
ALTER TABLE IF EXISTS opt_playbooks DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS opt_playbooks;
