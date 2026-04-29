-- 0051 — Optimiser v1.6: opt_causal_deltas.
-- Reference: addendum §3.1, §4.3, §9.8.5.
--
-- Records the attributed effect of each applied proposal once it
-- accumulates enough post-rollout data. Powers the "what happened
-- last time we did this" panel on the proposal review screen and
-- the causal-delta column on the §4.2 score history view.
--
-- Append-only — one row per (proposal, evaluation_window). The
-- post-rollout cron writes a row when:
--   - 14 days since rollout (or per-client override on
--     opt_clients.causal_eval_window_days)  OR
--   - 300+ sessions on the new version
-- whichever comes first.
--
-- The attributed effect feeds back into opt_playbooks.seed_impact_*
-- via the §9.4.2 calibration loop.

CREATE TABLE opt_causal_deltas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  landing_page_id          uuid NOT NULL
    REFERENCES opt_landing_pages(id) ON DELETE CASCADE,
  proposal_id              uuid NOT NULL
    REFERENCES opt_proposals(id) ON DELETE CASCADE,

  -- Snapshot of the structured change set from the proposal at
  -- approval time. Stored verbatim so the causal-delta UI shows
  -- exactly what was changed even if the proposal's change_set
  -- column drifts (it shouldn't, but defensive).
  change_set               jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Range from the proposal's expected_impact_min/max_pp at approval.
  -- {"min_pp": 5, "max_pp": 10} shape.
  expected_impact          jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Measured deltas. NULL if the metric wasn't available on either side
  -- of the rollout window.
  --
  -- actual_impact_cr = (post_cr - pre_cr) / pre_cr — relative %.
  -- actual_impact_score = post_composite - pre_composite — absolute pts.
  actual_impact_cr         numeric(8, 5),
  actual_impact_score      integer,

  -- §9.4.1 confidence sub-factors against the post-rollout window.
  confidence_score         numeric(4, 3)
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  confidence_sample        numeric(4, 3),
  confidence_freshness     numeric(4, 3),
  confidence_stability     numeric(4, 3),
  confidence_signal        numeric(4, 3),

  -- Triggering playbook id (denormalised from opt_proposals so the
  -- "past N CTA-move proposals" query is a single-table scan).
  triggering_playbook_id   text REFERENCES opt_playbooks(id) ON DELETE SET NULL,

  -- Pre/post window timestamps. Shape: same duration on each side,
  -- aligned to the rollout day.
  evaluation_window_start  timestamptz NOT NULL,
  evaluation_window_end    timestamptz NOT NULL,

  -- TRUE once this row's actual_impact_cr / actual_impact_score has
  -- fed the §9.4.2 playbook calibration loop. Phase 1 ships the
  -- writer; Phase 2 wires the loop.
  fed_into_calibration     boolean NOT NULL DEFAULT false,

  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opt_causal_deltas_window_coherent CHECK (
    evaluation_window_end > evaluation_window_start
  )
);

-- One causal-delta row per proposal — re-running the evaluation cron
-- on the same proposal updates the existing row (UPSERT on
-- proposal_id) rather than appending duplicates. The cron treats it
-- as a side-effect-of-an-evaluation-window record, not a stream.
CREATE UNIQUE INDEX opt_causal_deltas_proposal_uniq
  ON opt_causal_deltas (proposal_id);

CREATE INDEX opt_causal_deltas_client_created_idx
  ON opt_causal_deltas (client_id, created_at DESC);

CREATE INDEX opt_causal_deltas_landing_page_idx
  ON opt_causal_deltas (landing_page_id, created_at DESC);

-- Hot-path index for the proposal-review "what happened last time"
-- panel — joined on (client_id, triggering_playbook_id) ordered by
-- created_at desc.
CREATE INDEX opt_causal_deltas_client_playbook_idx
  ON opt_causal_deltas (client_id, triggering_playbook_id, created_at DESC)
  WHERE triggering_playbook_id IS NOT NULL;

ALTER TABLE opt_causal_deltas ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_causal_deltas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_causal_deltas_read ON opt_causal_deltas
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
