-- Rollback for 0058_optimiser_phase_2_playbooks.sql
DELETE FROM opt_playbooks WHERE id IN (
  'trust_gap',
  'intent_mismatch',
  'stale_social_proof',
  'rage_click_hotspot',
  'dead_click_pattern',
  'exit_intent_high'
);
