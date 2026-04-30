-- 0059 — Optimiser Phase 2 Slice 21: assisted approval mode.
-- Reference: docs/Optimisation_Engine_Spec_v1.5.docx §6 feature 12,
-- §12.3 (assisted-approval mode with per-client override).
--
-- One column on opt_clients. Per the spec the feature is opt-in only,
-- so default FALSE preserves Phase 1's manual-approval contract for
-- existing clients without any operator action.

ALTER TABLE opt_clients
  ADD COLUMN assisted_approval_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN opt_clients.assisted_approval_enabled IS
  'Phase 2 §6 feature 12. When TRUE, low-risk proposals (risk_level=low + effort_bucket=1) auto-approve after 48 hours of being pending and unreviewed. High-risk proposals always require manual approval regardless of this setting.';
