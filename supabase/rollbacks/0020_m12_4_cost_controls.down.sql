-- Rollback for 0020 — drops cost-control columns.
--
-- Columns dropped in the order opposite to their add so the allowlist
-- CHECK on briefs.text_model / briefs.visual_model is removed with its
-- column (DROP COLUMN cascades the constraint automatically).

ALTER TABLE tenant_cost_budgets
  DROP COLUMN IF EXISTS per_page_ceiling_cents_override;

ALTER TABLE briefs
  DROP COLUMN IF EXISTS visual_model,
  DROP COLUMN IF EXISTS text_model;

ALTER TABLE brief_runs
  DROP COLUMN IF EXISTS run_cost_cents;

ALTER TABLE brief_pages
  DROP COLUMN IF EXISTS quality_flag,
  DROP COLUMN IF EXISTS page_cost_cents;
