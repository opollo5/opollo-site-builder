-- 0043 — Optimiser: opt_playbook_calibration.
-- Reference: spec §9.4.2 (calibration loop), §5.1.
--
-- Append-only log of playbook impact recalibration as A/B test outcomes
-- resolve. Phase 1 ships the table empty; Phase 2's A/B winner-detection
-- pipeline writes to it. opt_playbooks.seed_impact_min/max_pp is updated
-- in place via the §9.4.2 weighted-average rule, with each update
-- preceded by a row here so the calibration history is reconstructible.

CREATE TABLE opt_playbook_calibration (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id              text NOT NULL
    REFERENCES opt_playbooks(id) ON DELETE CASCADE,

  -- The A/B test that produced this observation. NULL for manual
  -- (admin-driven) recalibration entries.
  source_test_id           uuid,
  client_id                uuid REFERENCES opt_clients(id) ON DELETE SET NULL,

  -- Observed CR uplift (percentage points). May be negative if the
  -- variant lost the test.
  observed_uplift_pp       numeric(6, 3) NOT NULL,
  observed_sample_size     integer NOT NULL CHECK (observed_sample_size >= 0),
  observed_significance    numeric(4, 3),

  -- Snapshots of the playbook's seed impact range BEFORE and AFTER
  -- this row was applied. Lets a reader reconstruct the playbook's
  -- baseline at any point without replaying every prior row.
  seed_min_before_pp       numeric(6, 3) NOT NULL,
  seed_max_before_pp       numeric(6, 3) NOT NULL,
  seed_min_after_pp        numeric(6, 3) NOT NULL,
  seed_max_after_pp        numeric(6, 3) NOT NULL,

  -- 'observed' (A/B test resolution) | 'manual_override' (admin set
  -- a baseline directly) | 'retirement' (admin retired the playbook
  -- under the §9.4.2 + Q7 process).
  reason                   text NOT NULL DEFAULT 'observed'
    CHECK (reason IN ('observed', 'manual_override', 'retirement')),

  notes                    text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX opt_playbook_calibration_playbook_idx
  ON opt_playbook_calibration (playbook_id, created_at DESC);

ALTER TABLE opt_playbook_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_playbook_calibration
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_playbook_calibration_read ON opt_playbook_calibration
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
