-- 0049 — Optimiser v1.6: opt_clients column additions for composite scoring.
-- Reference: addendum §2.1, §2.3, §3.2, §6.2 Q1.6.3.
--
-- Three new nullable / defaulted columns. Forward-only, no rewrite.
-- Existing rows pick up the defaults on read.

ALTER TABLE opt_clients
  ADD COLUMN score_weights jsonb NOT NULL DEFAULT jsonb_build_object(
    'alignment', 0.25,
    'behaviour', 0.30,
    'conversion', 0.30,
    'technical', 0.15
  );

-- Tracks which conversion sub-components are available for the client.
-- Drives the §2.3 redistribution: when revenue is unavailable, the 0.20
-- weight folds into CR (0.65) + CPA (0.35). Defaults assume CR + CPA
-- only — revenue tracking is opt-in via the client settings page.
ALTER TABLE opt_clients
  ADD COLUMN conversion_components_present jsonb NOT NULL DEFAULT jsonb_build_object(
    'cr', true,
    'cpa', true,
    'revenue', false
  );

-- §6.2 Q1.6.3 — per-client override for the causal-delta measurement
-- window. Default 14 days per addendum §4.3; lower-traffic B2B clients
-- may extend.
ALTER TABLE opt_clients
  ADD COLUMN causal_eval_window_days integer NOT NULL DEFAULT 14
    CHECK (causal_eval_window_days >= 1 AND causal_eval_window_days <= 90);

COMMENT ON COLUMN opt_clients.score_weights IS
  'Composite-score sub-score weights per addendum §2.1. JSON object with keys alignment / behaviour / conversion / technical, each in [0,1]. Defaults in §2.1.';
COMMENT ON COLUMN opt_clients.conversion_components_present IS
  'Which conversion sub-components are available. Drives the §2.3 redistribution when revenue tracking is missing.';
COMMENT ON COLUMN opt_clients.causal_eval_window_days IS
  'Per-client override for the causal-delta measurement window (addendum §4.3 / §6.2 Q1.6.3). Default 14 days.';
