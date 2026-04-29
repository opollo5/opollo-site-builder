-- 0046 — Optimiser: opt_change_log.
-- Reference: spec §5.1 (opt_change_log "full audit trail"),
-- §9.8.2 (status moves to applied; opt_change_log records),
-- feature 11 (change tracking + transparency).
--
-- Append-only audit trail of every page change applied through the
-- engine. One row per state-affecting event:
--   - proposal_submitted   → brief sent to Site Builder (Phase 1.5)
--   - page_regenerated     → Site Builder write-back complete
--   - rolled_back          → manual or auto-rollback (§12.2.1)
--   - reverted             → applied_then_reverted via auto-rollback
--   - reprompted           → post-build reprompt (§9.8.3)
--   - manual_rollback      → staff-initiated revert (§9.10 / Slice 6)
--
-- No deletes. No updates. Insert-only. Retention deferred to Q6 in
-- the spec — table is append-forever for now.

CREATE TABLE opt_change_log (
  id                  bigserial PRIMARY KEY,
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE RESTRICT,
  proposal_id         uuid REFERENCES opt_proposals(id) ON DELETE SET NULL,
  landing_page_id     uuid REFERENCES opt_landing_pages(id) ON DELETE SET NULL,

  event               text NOT NULL,

  -- Ties back to Site Builder's brief / page_history rows when an event
  -- corresponds to a generation pass. NULL for purely engine-internal
  -- events.
  brief_id            uuid,
  page_id             uuid,
  page_version        text,

  -- Free-form payload describing the change set, before/after diff
  -- pointers, rollback reason, etc.
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,

  actor_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opt_change_log_client_created_idx
  ON opt_change_log (client_id, created_at DESC);
CREATE INDEX opt_change_log_proposal_idx
  ON opt_change_log (proposal_id, created_at DESC)
  WHERE proposal_id IS NOT NULL;
CREATE INDEX opt_change_log_landing_page_idx
  ON opt_change_log (landing_page_id, created_at DESC)
  WHERE landing_page_id IS NOT NULL;

ALTER TABLE opt_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_change_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_change_log_read ON opt_change_log
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
