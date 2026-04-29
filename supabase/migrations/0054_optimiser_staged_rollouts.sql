-- 0054 — OPTIMISER PHASE 1.5 SLICE 16: staged rollout tracking + monitor.
--
-- New table opt_staged_rollouts holds the lifecycle of a post-apply
-- rollout: when generation succeeds (slice 15), a rollout row is
-- created in 'live' state. The hourly monitor cron evaluates §12.2.1
-- thresholds and transitions the row to one of:
--   - 'promoted'         — floors met + thresholds clear, traffic
--                          flips to 100%
--   - 'auto_reverted'    — a rollback threshold tripped; previous
--                          version restored
--   - 'manually_promoted'— operator promoted before floors met
--   - 'failed'           — monitor couldn't evaluate (data gap, etc.)
--
-- Traffic splitting mechanism is intentionally deferred to a follow-up
-- sub-slice (Ads API URL swap vs JS hash split — both non-trivial).
-- The rollout row tracks the intended split + thresholds; monitor
-- reads page-level metrics as a proxy until the real splitter lands.
--
-- regression_check_results captures every monitor run's evaluation as
-- a JSONB array entry so operators can audit "why did the monitor
-- decide what it did".

CREATE TABLE opt_staged_rollouts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  proposal_id                 uuid NOT NULL
    REFERENCES opt_proposals(id) ON DELETE CASCADE,
  page_id                     uuid REFERENCES pages(id) ON DELETE SET NULL,
  client_id                   uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  started_at                  timestamptz NOT NULL DEFAULT now(),

  -- Snapshot of the per-client staged_rollout_config at start. Lets
  -- the monitor evaluate against the config that was in effect when
  -- the rollout was created, even if opt_clients.staged_rollout_config
  -- is edited mid-flight.
  config_snapshot             jsonb NOT NULL,

  -- Initial split percentage (mirrored from config_snapshot for fast
  -- read; the monitor never changes this, only current_state).
  traffic_split_percent       int NOT NULL DEFAULT 20
    CHECK (traffic_split_percent BETWEEN 0 AND 100),

  current_state               text NOT NULL DEFAULT 'live'
    CHECK (current_state IN (
      'live',
      'auto_reverted',
      'promoted',
      'manually_promoted',
      'failed'
    )),

  -- Append-only log of every monitor evaluation. Each entry is
  -- { evaluated_at, decision, sessions, conversions, cr_new, cr_baseline,
  --   bounce_new, bounce_baseline, error_rate, threshold_trips: [] }.
  regression_check_results    jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Terminal-state metadata.
  ended_at                    timestamptz,
  end_reason                  text, -- e.g. 'cr_drop_15pct', 'floors_met_promote', 'window_expired'
  ended_by                    uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT opt_staged_rollouts_terminal_coherent CHECK (
    (current_state = 'live' AND ended_at IS NULL AND end_reason IS NULL)
    OR (current_state <> 'live' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)
  )
);

-- Hot-path query: monitor cron pulls all 'live' rollouts.
CREATE INDEX opt_staged_rollouts_live_idx
  ON opt_staged_rollouts (started_at)
  WHERE current_state = 'live';

-- Joined-from-proposal lookups.
CREATE INDEX opt_staged_rollouts_proposal_idx
  ON opt_staged_rollouts (proposal_id);

CREATE INDEX opt_staged_rollouts_client_idx
  ON opt_staged_rollouts (client_id, started_at DESC);

ALTER TABLE opt_staged_rollouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_staged_rollouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE opt_staged_rollouts IS
  'Lifecycle row for a post-apply staged rollout. Created when a brief_run linked to a proposal succeeds (slice 15 + 16). Monitor cron transitions live → promoted | auto_reverted | failed based on §12.2.1 thresholds. Added 2026-04-30 (OPTIMISER-16).';

COMMENT ON COLUMN opt_staged_rollouts.config_snapshot IS
  'Frozen per-client staged_rollout_config at rollout start. Keys: initial_traffic_split_percent, minimum_sessions, minimum_conversions, minimum_time_hours, cr_drop_rollback_pct, cr_drop_significance, bounce_spike_rollback_pct, error_spike_rollback_rate, maximum_window_days.';

COMMENT ON COLUMN opt_staged_rollouts.regression_check_results IS
  'Append-only JSONB array — each monitor tick appends an entry with decision, observed metrics, and which thresholds (if any) tripped. Operators audit this to understand auto-rollbacks.';
