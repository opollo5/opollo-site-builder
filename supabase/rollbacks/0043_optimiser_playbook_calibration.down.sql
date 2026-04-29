-- Rollback for 0043_optimiser_playbook_calibration.sql
DROP POLICY IF EXISTS opt_playbook_calibration_read ON opt_playbook_calibration;
DROP POLICY IF EXISTS service_role_all ON opt_playbook_calibration;
ALTER TABLE IF EXISTS opt_playbook_calibration DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_playbook_calibration_playbook_idx;
DROP TABLE IF EXISTS opt_playbook_calibration;
