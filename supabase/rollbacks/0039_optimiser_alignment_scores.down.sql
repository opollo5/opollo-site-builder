-- Rollback for 0039_optimiser_alignment_scores.sql
DROP POLICY IF EXISTS opt_alignment_scores_read ON opt_alignment_scores;
DROP POLICY IF EXISTS service_role_all ON opt_alignment_scores;
ALTER TABLE IF EXISTS opt_alignment_scores DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_alignment_scores_page_idx;
DROP INDEX IF EXISTS opt_alignment_scores_pair_uniq;
DROP TABLE IF EXISTS opt_alignment_scores;
