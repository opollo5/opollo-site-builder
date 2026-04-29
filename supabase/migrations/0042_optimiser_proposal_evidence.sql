-- 0042 — Optimiser: opt_proposal_evidence.
-- Reference: spec §9.1, §5.1.
--
-- Append-only join table linking a proposal to the specific data rows
-- that justify it. Required for transparency: every proposal can be
-- traced back to one or more (metric, dimension, observed value)
-- triples and / or the alignment-score row that triggered it.
--
-- One proposal has many evidence rows. Each row is immutable post-
-- insert; the proposal's review pane reads them in display_order.

CREATE TABLE opt_proposal_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL
    REFERENCES opt_proposals(id) ON DELETE CASCADE,

  display_order       integer NOT NULL DEFAULT 0,

  -- 'metric' | 'alignment_score' | 'search_term' | 'ad_headline' |
  -- 'page_snapshot' — extensible.
  evidence_type       text NOT NULL,

  -- Source-specific identifier; the type column tells the reader how
  -- to interpret it. metric_daily_id / alignment_score_id / etc.
  source_id           uuid,

  -- Free-form payload describing the observation: metric name, value,
  -- threshold, window. Slice 5's evidence renderer pins the schema.
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- One-line human-readable label rendered next to the evidence row
  -- in the review pane.
  label               text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opt_proposal_evidence_proposal_idx
  ON opt_proposal_evidence (proposal_id, display_order);

ALTER TABLE opt_proposal_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_proposal_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same visibility as the parent proposal: if you can read it, you can
-- read its evidence. Inherits the proposal's role gate.
CREATE POLICY opt_proposal_evidence_read ON opt_proposal_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM opt_proposals p
      WHERE p.id = opt_proposal_evidence.proposal_id
        AND public.auth_role() IN ('admin', 'operator', 'viewer')
    )
  );
