-- Rollback for 0050_opt_landing_pages_composite_score.sql
ALTER TABLE opt_landing_pages DROP COLUMN IF EXISTS conversion_n_a;
ALTER TABLE opt_landing_pages DROP COLUMN IF EXISTS current_classification;
ALTER TABLE opt_landing_pages DROP COLUMN IF EXISTS current_composite_score;
