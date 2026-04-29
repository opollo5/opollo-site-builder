-- Rollback for 0048_opt_score_calibration.sql
DROP POLICY IF EXISTS opt_score_calibration_read ON opt_score_calibration;
DROP POLICY IF EXISTS service_role_all ON opt_score_calibration;
ALTER TABLE IF EXISTS opt_score_calibration DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_score_calibration_client_created_idx;
DROP TABLE IF EXISTS opt_score_calibration;
