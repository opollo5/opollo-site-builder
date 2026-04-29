-- 0050 — Optimiser v1.6: opt_landing_pages cached composite-score columns.
-- Reference: addendum §3.2, §2.4.
--
-- Three new columns on opt_landing_pages. Cached so the page browser
-- renders the green/amber/red badge without joining against
-- opt_page_score_history every row.
--
-- The score-evaluator cron updates these alongside writing the history
-- row.

ALTER TABLE opt_landing_pages
  ADD COLUMN current_composite_score integer
    CHECK (current_composite_score IS NULL OR (current_composite_score >= 0 AND current_composite_score <= 100));

ALTER TABLE opt_landing_pages
  ADD COLUMN current_classification text
    CHECK (current_classification IS NULL OR current_classification IN ('high_performer', 'optimisable', 'needs_attention'));

-- Operator flag for awareness-stage pages with no conversion goal.
-- Set during onboarding (Slice 12 ships read-only display; Phase 2
-- adds an editable surface). When TRUE, the composite formula
-- redistributes the 0.30 conversion weight equally across the other
-- three sub-scores per addendum §2.4.
ALTER TABLE opt_landing_pages
  ADD COLUMN conversion_n_a boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN opt_landing_pages.current_composite_score IS
  'Cached composite score (0-100). Updated by the score-evaluator cron alongside writing opt_page_score_history. NULL when insufficient data per §9.5.';
COMMENT ON COLUMN opt_landing_pages.current_classification IS
  'Cached classification label. high_performer (80-100) / optimisable (60-79) / needs_attention (0-59).';
COMMENT ON COLUMN opt_landing_pages.conversion_n_a IS
  'Operator flag for pages without a conversion goal. When TRUE the composite redistributes the 0.30 conversion weight per addendum §2.4.';
