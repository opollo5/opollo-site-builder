-- 0047 — Optimiser v1.6: opt_page_score_history.
-- Reference: docs/Optimisation_Engine_v1.6_Addendum.docx §3.1, §4.2.
--
-- One row per (page, version, evaluation timestamp). Powers the
-- score-over-time view (§4.2) and the sparkline on the page detail
-- panel (§4.1).
--
-- Append-only — score evaluations are forward-rolling timeline events,
-- never edited in place. The cron at /api/cron/optimiser-evaluate-
-- scores writes one row per managed page per day where data is
-- sufficient.
--
-- weights_used is captured per row so a reader can reconstruct exactly
-- how the composite was computed at the time, even after the client's
-- opt_clients.score_weights changes.

CREATE TABLE opt_page_score_history (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  landing_page_id          uuid NOT NULL
    REFERENCES opt_landing_pages(id) ON DELETE CASCADE,

  -- Optional reference to the Site Builder pages row's version.
  -- NULL for pages still in management_mode='read_only' that don't
  -- have a Site Builder row.
  page_version             text,

  composite_score          integer NOT NULL
    CHECK (composite_score >= 0 AND composite_score <= 100),
  classification           text NOT NULL
    CHECK (classification IN ('high_performer', 'optimisable', 'needs_attention')),

  -- Each sub-score 0–100. NULL when the sub-score input was
  -- unavailable but the composite was still computed via
  -- redistribution (e.g. conversion_n_a pages skip the conversion
  -- sub-score and redistribute its 0.30 weight).
  alignment_subscore       integer
    CHECK (alignment_subscore IS NULL OR (alignment_subscore >= 0 AND alignment_subscore <= 100)),
  behaviour_subscore       integer
    CHECK (behaviour_subscore IS NULL OR (behaviour_subscore >= 0 AND behaviour_subscore <= 100)),
  conversion_subscore      integer
    CHECK (conversion_subscore IS NULL OR (conversion_subscore >= 0 AND conversion_subscore <= 100)),
  technical_subscore       integer
    CHECK (technical_subscore IS NULL OR (technical_subscore >= 0 AND technical_subscore <= 100)),

  -- Snapshot of opt_clients.score_weights at the time the score was
  -- computed. Reading this directly avoids ambiguity if the client's
  -- weights change between evaluations.
  weights_used             jsonb NOT NULL,

  -- §9.4.1 confidence sub-factors carried through to the score so
  -- the breakdown panel can show the same number the proposal pane
  -- shows. NULL when not applicable (e.g. brand-new page with no
  -- behaviour history).
  confidence               numeric(4, 3)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  -- Optional reference to the proposal that triggered this version,
  -- for the §4.2 timeline row.
  triggering_proposal_id   uuid REFERENCES opt_proposals(id) ON DELETE SET NULL,

  -- Free-form summary of the change set behind this version. Mirrored
  -- from opt_proposals.change_set when triggering_proposal_id is set;
  -- NULL for the initial baseline row.
  change_set_summary       text,

  evaluated_at             timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opt_page_score_history_page_evaluated_idx
  ON opt_page_score_history (landing_page_id, evaluated_at DESC);

CREATE INDEX opt_page_score_history_client_evaluated_idx
  ON opt_page_score_history (client_id, evaluated_at DESC);

CREATE INDEX opt_page_score_history_proposal_idx
  ON opt_page_score_history (triggering_proposal_id)
  WHERE triggering_proposal_id IS NOT NULL;

ALTER TABLE opt_page_score_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_page_score_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_page_score_history_read ON opt_page_score_history
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
