-- Rollback for 0061_optimiser_pattern_library.sql
DROP POLICY IF EXISTS opt_pattern_library_read ON opt_pattern_library;
DROP POLICY IF EXISTS service_role_all ON opt_pattern_library;
ALTER TABLE IF EXISTS opt_pattern_library DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_pattern_library_type_confidence_idx;
DROP INDEX IF EXISTS opt_pattern_library_playbook_idx;
DROP INDEX IF EXISTS opt_pattern_library_uniq;
DROP TABLE IF EXISTS opt_pattern_library;
