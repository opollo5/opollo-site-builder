-- 0048 — Optimiser v1.6: opt_score_calibration.
-- Reference: addendum §2.5 + §3.1.
--
-- Append-only log of weight changes from the calibration loop. Phase 2
-- A/B test outcomes drive automatic weight adjustments; Phase 1 staff
-- can manually override via the client settings page (the writer for
-- that lands when weights become editable in Phase 2). Phase 1 ships
-- the table empty.
--
-- weight_before / weight_after are full snapshots (the four-key shape)
-- so a reader can reconstruct the timeline without joining against
-- opt_clients (which only carries the current values).

CREATE TABLE opt_score_calibration (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  weight_before            jsonb NOT NULL,
  weight_after             jsonb NOT NULL,

  -- 'manual_override' (admin-driven from settings page) |
  -- 'observed_calibration' (Phase 2 A/B test outcome) |
  -- 'reset_to_defaults'.
  trigger                  text NOT NULL DEFAULT 'manual_override'
    CHECK (trigger IN ('manual_override', 'observed_calibration', 'reset_to_defaults')),

  -- Optional pointer to the test that drove an observed_calibration
  -- entry. NULL otherwise.
  source_test_id           uuid,

  notes                    text,

  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX opt_score_calibration_client_created_idx
  ON opt_score_calibration (client_id, created_at DESC);

ALTER TABLE opt_score_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_score_calibration
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_score_calibration_read ON opt_score_calibration
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
