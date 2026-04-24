-- 0018 — M12-3 runner-state columns on brief_pages + brief_runs.
-- Reference: docs/plans/m12-parent.md §M12-3 + §Write-safety contract.
--
-- Additive-only ALTER TABLE. No new tables. The M12-1 migration header
-- said M12-2 and M12-3 are "app-layer slices, no further schema churn";
-- we interpret that as "no new tables" rather than "no ALTERs" because
-- the runner state needs persistable columns (draft_html, critique_log,
-- current_pass_kind, etc.) and cramming them into JSONB blobs in
-- existing columns would hurt observability and query-ability.
--
-- Columns added to brief_pages — the per-page runner state machine:
--
--   page_status         — enum. Drives the operator-visible state
--                         machine from the parent plan §M12-5:
--                         pending → generating → awaiting_review →
--                         approved | failed | skipped.
--
--   current_pass_kind   — which pass the runner was last executing.
--                         NULL = not yet started. Resume-after-crash
--                         reads this to determine the entry point.
--
--   current_pass_number — 0-indexed counter within the current page.
--
--   draft_html          — latest pass output. Overwritten each pass.
--
--   generated_html      — promoted from draft_html on operator approve.
--                         Immutable once set; schema-coherent with
--                         page_status='approved'.
--
--   critique_log        — jsonb array of per-pass output, NOT NULL
--                         DEFAULT [] so M12-1 inserts don't need to
--                         know about the column.
--
--   approved_at /
--   approved_by         — audit columns for the approve action.
--
-- brief_runs.content_summary — cross-page context carrier, appended on
-- every approve. Cap + compaction live in the runner (app-layer).

ALTER TABLE brief_pages
  ADD COLUMN page_status text NOT NULL DEFAULT 'pending'
    CHECK (page_status IN (
      'pending',
      'generating',
      'awaiting_review',
      'approved',
      'failed',
      'skipped'
    )),
  ADD COLUMN current_pass_kind text,
  ADD COLUMN current_pass_number int NOT NULL DEFAULT 0
    CHECK (current_pass_number >= 0),
  ADD COLUMN draft_html text,
  ADD COLUMN generated_html text,
  ADD COLUMN critique_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES opollo_users(id) ON DELETE SET NULL;

ALTER TABLE brief_pages
  ADD CONSTRAINT brief_pages_approved_coherent
    CHECK (
      (page_status = 'approved' AND approved_at IS NOT NULL)
      OR (page_status <> 'approved' AND approved_at IS NULL)
    );

ALTER TABLE brief_pages
  ADD CONSTRAINT brief_pages_generated_html_coherent
    CHECK (
      (page_status = 'approved' AND generated_html IS NOT NULL)
      OR (page_status <> 'approved' AND generated_html IS NULL)
    );

COMMENT ON COLUMN brief_pages.page_status IS
  'Per-page runner state machine: pending → generating → awaiting_review → (approved | failed | skipped). Schema-enforced enum.';
COMMENT ON COLUMN brief_pages.current_pass_kind IS
  'Pass the runner was last executing. NULL until first pass starts. Combined with current_pass_number, gives the resume-after-crash entry point. M12-3 values: draft, self_critique, revise.';
COMMENT ON COLUMN brief_pages.draft_html IS
  'Latest pass output. Overwritten each pass — history lives in critique_log. NULL until the draft pass completes.';
COMMENT ON COLUMN brief_pages.generated_html IS
  'Promoted from draft_html on operator approve. Immutable once set. Schema-enforced coherent with page_status=approved.';
COMMENT ON COLUMN brief_pages.critique_log IS
  'JSONB array. One entry per pass: { pass_kind, pass_number, anthropic_response_id, output, usage }.';

ALTER TABLE brief_runs
  ADD COLUMN content_summary text NOT NULL DEFAULT '';

COMMENT ON COLUMN brief_runs.content_summary IS
  'Running compressed summary the runner appends on every page approve. Cap + compaction live in lib/brief-runner.ts (app-layer).';
