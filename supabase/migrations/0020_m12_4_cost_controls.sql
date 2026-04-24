-- 0020 — M12-4 cost-control columns on brief_pages + brief_runs + briefs +
-- tenant_cost_budgets. Reference: docs/plans/m12-parent.md §Cost controls
-- (M12-4 amendment) + §Risks identified and mitigated #13/#14/#15.
--
-- Numbering note: M13-1 landed 0019 on main while this PR was in-flight.
-- This slice's additive migration is ordering-independent (M12 tables
-- don't reference M13's posts table, and vice versa), so bumping to
-- 0020 is a pure file rename.
--
-- Additive-only ALTER TABLE. Every column has a safe DEFAULT so existing
-- rows from M12-1/M12-2/M12-3 fold in without a backfill job.
--
-- brief_pages:
--   page_cost_cents  — running sum of every billed Anthropic call's cost
--                      on this page (text + visual). Stamped on every
--                      pass UPDATE inside the same CAS transaction as
--                      the critique_log write.
--
--   quality_flag     — 'cost_ceiling' when the visual-review loop was
--                      halted by the per-page cost ceiling before
--                      converging; 'capped_with_issues' when the 2-
--                      iteration cap was reached while critique still
--                      flagged severity-high. NULL is the clean case.
--                      Operator sees the flag in M12-5's review surface.
--
-- brief_runs:
--   run_cost_cents   — running sum of every page's page_cost_cents.
--                      Rolled up on every pass UPDATE. Used by the
--                      admin read path M12-5 surfaces + the pre-flight
--                      cost estimator's post-run reconciliation.
--
-- briefs:
--   text_model       — Anthropic model used for the text pass loop
--                      (draft / self_critique / revise / visual_revise).
--
--   visual_model     — Anthropic model used for the multi-modal visual
--                      critique pass. Usually Sonnet is enough; Opus
--                      is reserved for complex-judgment briefs.
--
--   Both default to claude-sonnet-4-6 — the lib/anthropic-pricing.ts
--   mid-tier. Runner validates against the PRICING_TABLE keys at
--   pass-start; unknown value → page fails with INVALID_MODEL (no
--   call fired). Defense-in-depth: the CHECK below pins the allowed
--   set at the DB level so an ops-layer UPDATE cannot silently set
--   an arbitrary model.
--
-- tenant_cost_budgets:
--   per_page_ceiling_cents_override — NULL means use the lib-layer
--                      default (200 cents). A tenant that runs
--                      high-cost Opus briefs can raise the ceiling;
--                      a tenant with a tight budget can lower it.
--                      CHECK >= 1 so a zero doesn't accidentally
--                      brick the runner.

-- page_cost_cents is `int` (not bigint) because:
--   a) real-world brief runs bottom out at a few hundred cents per page
--      (ceiling is 200c default); int4 max 2_147_483_647 cents = $21M
--      is several orders of magnitude larger than any conceivable run.
--   b) node-pg returns bigint as a STRING by default — that bites the
--      in-memory `page.page_cost_cents += passCost` idiom (string
--      concatenation instead of numeric addition), so staying at int
--      avoids the SerDe trap without having to configure custom parsers.
ALTER TABLE brief_pages
  ADD COLUMN page_cost_cents int NOT NULL DEFAULT 0
    CHECK (page_cost_cents >= 0),
  ADD COLUMN quality_flag text
    CHECK (quality_flag IS NULL OR quality_flag IN (
      'cost_ceiling',
      'capped_with_issues'
    ));

COMMENT ON COLUMN brief_pages.page_cost_cents IS
  'Running sum of every billed Anthropic call against this page. Integer cents to avoid float drift. Stamped on every pass UPDATE inside the same CAS transaction as the critique_log write.';
COMMENT ON COLUMN brief_pages.quality_flag IS
  'Set when the visual-review loop halted without converging: cost_ceiling (per-page cents ceiling hit) or capped_with_issues (2-iteration cap reached with severity-high critique remaining). NULL = clean.';

-- Same int (not bigint) reasoning as page_cost_cents above.
ALTER TABLE brief_runs
  ADD COLUMN run_cost_cents int NOT NULL DEFAULT 0
    CHECK (run_cost_cents >= 0);

COMMENT ON COLUMN brief_runs.run_cost_cents IS
  'Running sum of every brief_pages.page_cost_cents for this run. Rolled up on every pass UPDATE. Feeds M12-5 operator cost visibility + post-run reconciliation against the tenant monthly cap.';

ALTER TABLE briefs
  ADD COLUMN text_model text NOT NULL DEFAULT 'claude-sonnet-4-6'
    CHECK (text_model IN (
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001'
    )),
  ADD COLUMN visual_model text NOT NULL DEFAULT 'claude-sonnet-4-6'
    CHECK (visual_model IN (
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001'
    ));

COMMENT ON COLUMN briefs.text_model IS
  'Anthropic model used by the brief runner for text passes (draft / self_critique / revise / visual_revise). Operator picks per-brief; defaults to Sonnet. CHECK pins the allowed set at the DB level.';
COMMENT ON COLUMN briefs.visual_model IS
  'Anthropic model used by the brief runner for the multi-modal visual critique. Separate from text_model because visual judgment is usually fine on Sonnet while text may want Opus (or vice versa). Same allowlist as text_model.';

ALTER TABLE tenant_cost_budgets
  ADD COLUMN per_page_ceiling_cents_override int
    CHECK (per_page_ceiling_cents_override IS NULL OR per_page_ceiling_cents_override >= 1);

COMMENT ON COLUMN tenant_cost_budgets.per_page_ceiling_cents_override IS
  'Per-tenant override for the brief-runner per-page combined-cost ceiling (see M12-4 Risk #13). NULL means use the lib default (200 cents). CHECK >= 1 so a zero cannot brick the runner.';
