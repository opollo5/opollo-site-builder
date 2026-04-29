-- Rollback for 0051_opt_causal_deltas.sql
DROP POLICY IF EXISTS opt_causal_deltas_read ON opt_causal_deltas;
DROP POLICY IF EXISTS service_role_all ON opt_causal_deltas;
ALTER TABLE IF EXISTS opt_causal_deltas DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_causal_deltas_client_playbook_idx;
DROP INDEX IF EXISTS opt_causal_deltas_landing_page_idx;
DROP INDEX IF EXISTS opt_causal_deltas_client_created_idx;
DROP INDEX IF EXISTS opt_causal_deltas_proposal_uniq;
DROP TABLE IF EXISTS opt_causal_deltas;
