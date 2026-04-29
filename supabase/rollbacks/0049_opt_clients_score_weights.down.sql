-- Rollback for 0049_opt_clients_score_weights.sql
ALTER TABLE opt_clients DROP COLUMN IF EXISTS causal_eval_window_days;
ALTER TABLE opt_clients DROP COLUMN IF EXISTS conversion_components_present;
ALTER TABLE opt_clients DROP COLUMN IF EXISTS score_weights;
