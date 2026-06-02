-- ---------------------------------------------------------------------------
-- 0176_workflow_steps_and_engine.sql
--
-- Workflow Engine (B3): configurable multi-step approval workflow.
--
-- 1. workflow_steps — replaces the implicit 3-gate ordering for content proofs.
--    Pass rules: any_one / all_must only (no custom_count per scope decision).
-- 2. workflow_step_participants — per-step reviewer roles.
-- 3. social_approval_requests.step_id — which step this request belongs to.
-- 4. social_approval_recipients.is_blocking — role-aware quorum: non-blocking
--    reviewers can comment but don't affect finalization.
-- 5. Updated record_approval_decision RPC — adds is_blocking filter to quorum.
-- 6. Enum/type extensions for step-level events.
-- 7. Gate→step bridge (INSERT-only, lossless): creates workflow_steps from
--    existing enabled company_workflow_gates. company_workflow_gates is
--    UNTOUCHED — image_batch path continues reading it unchanged (zero
--    code changes to image-gate.ts / createBatchApprovalRequest).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. workflow_steps
-- ===========================================================================

CREATE TABLE workflow_steps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  step_order  int         NOT NULL,
  name        text        NOT NULL,
  pass_rule   text        NOT NULL DEFAULT 'any_one'
    CHECK (pass_rule IN ('any_one', 'all_must')),
  blocking    boolean     NOT NULL DEFAULT true,
  timeout_days int        NOT NULL DEFAULT 14,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workflow_steps_unique_order
    UNIQUE (company_id, step_order)
);

CREATE INDEX idx_workflow_steps_company ON workflow_steps(company_id);

ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_steps_service_role ON workflow_steps
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY workflow_steps_company_access ON workflow_steps
  FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

COMMENT ON TABLE workflow_steps IS
  'Ordered approval steps for content proof workflows (content_proof subject type). '
  'Replaces the implicit 3-gate ordering. company_workflow_gates is preserved and '
  'still used by the image_batch path (no code changes to that path).';

-- ===========================================================================
-- 2. workflow_step_participants
-- ===========================================================================

CREATE TABLE workflow_step_participants (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id          uuid        NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  platform_user_id uuid        REFERENCES platform_users(id) ON DELETE CASCADE,
  external_email   text,
  role             text        NOT NULL DEFAULT 'approver'
    CHECK (role IN ('reviewer', 'mandatory_reviewer', 'gatekeeper', 'approver')),
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wsp_identity_required
    CHECK (platform_user_id IS NOT NULL OR external_email IS NOT NULL)
);

CREATE INDEX idx_step_participants_step ON workflow_step_participants(step_id);

ALTER TABLE workflow_step_participants ENABLE ROW LEVEL SECURITY;

-- Service role has full access (all application paths use service_role)
CREATE POLICY wsp_service_role ON workflow_step_participants
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Operators can see their company's step participants
CREATE POLICY wsp_company_read ON workflow_step_participants
  FOR SELECT
  USING (
    is_opollo_staff()
    OR EXISTS (
      SELECT 1 FROM workflow_steps ws
       WHERE ws.id = step_id
         AND is_company_member(ws.company_id)
    )
  );

COMMENT ON TABLE workflow_step_participants IS
  'Reviewer assignments for each workflow step with role semantics. '
  'reviewer: non-blocking (can comment, does not hold the step). '
  'mandatory_reviewer: must decide before step closes. '
  'gatekeeper: blocking + can send back ONE step. '
  'approver: final-step decision maker.';

-- ===========================================================================
-- 3. social_approval_requests.step_id (nullable — V1/legacy rows = NULL)
-- ===========================================================================

ALTER TABLE social_approval_requests
  ADD COLUMN step_id uuid REFERENCES workflow_steps(id);

CREATE INDEX idx_approval_requests_step ON social_approval_requests(step_id)
  WHERE step_id IS NOT NULL;

COMMENT ON COLUMN social_approval_requests.step_id IS
  'Which workflow_steps row this approval request belongs to. '
  'NULL for legacy (pre-B3) approval requests and non-workflow proofs.';

-- ===========================================================================
-- 4. social_approval_recipients.is_blocking (DEFAULT true — backward safe)
-- ===========================================================================

ALTER TABLE social_approval_recipients
  ADD COLUMN is_blocking boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN social_approval_recipients.is_blocking IS
  'true for mandatory_reviewer / gatekeeper / approver roles (counts toward quorum). '
  'false for non-blocking reviewer (decision recorded but does not affect finalization). '
  'DEFAULT true preserves existing behaviour for all pre-B3 recipients.';

-- ===========================================================================
-- 5. Update record_approval_decision RPC to honour is_blocking
--
-- Only change: two quorum SELECT statements gain AND is_blocking = true.
-- All other logic is identical. Backward-safe because all existing rows
-- have is_blocking = true (DEFAULT).
-- ===========================================================================

CREATE OR REPLACE FUNCTION record_approval_decision(
  p_recipient_id UUID,
  p_decision     social_approval_event_type,
  p_comment      TEXT,
  p_ip           INET,
  p_user_agent   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipient    social_approval_recipients%ROWTYPE;
  v_request      social_approval_requests%ROWTYPE;
  v_post_state   social_post_state;
  v_now          TIMESTAMPTZ := now();
  v_finalise     BOOLEAN := false;
  v_final_state  social_post_state;
  v_active_count INT;
  v_approved_count INT;
  v_event_id     UUID;
  v_finalised_now BOOLEAN := false;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'changes_requested') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_STATE: decision must be approved | rejected | changes_requested.';
  END IF;

  -- 1. Recipient + parent request lookup.
  SELECT * INTO v_recipient FROM social_approval_recipients
   WHERE id = p_recipient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'NOT_FOUND: recipient.';
  END IF;
  IF v_recipient.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_STATE: recipient revoked.';
  END IF;

  SELECT * INTO v_request FROM social_approval_requests
   WHERE id = v_recipient.approval_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'NOT_FOUND: approval request.';
  END IF;
  IF v_request.revoked_at IS NOT NULL
     OR v_request.final_approved_at IS NOT NULL
     OR v_request.final_rejected_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_STATE: approval request is finalised.';
  END IF;

  -- 2. Idempotency.
  IF EXISTS (
    SELECT 1 FROM social_approval_events
     WHERE recipient_id = p_recipient_id
       AND event_type IN ('approved', 'rejected', 'changes_requested')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_STATE: this reviewer already lodged a decision.';
  END IF;

  -- 3. INSERT the event.
  INSERT INTO social_approval_events (
    approval_request_id, recipient_id, event_type,
    comment_text, bound_identity_email, bound_identity_name,
    ip_address, user_agent, occurred_at
  )
  VALUES (
    v_recipient.approval_request_id, p_recipient_id, p_decision,
    NULLIF(TRIM(p_comment), ''), v_recipient.email, v_recipient.name,
    p_ip, p_user_agent, v_now
  )
  RETURNING id INTO v_event_id;

  -- 4. Decide if this event finalises the request.
  IF p_decision = 'rejected' OR p_decision = 'changes_requested' THEN
    v_finalise := true;
    v_final_state := p_decision::text::social_post_state;
  ELSIF p_decision = 'approved' THEN
    IF v_request.approval_rule = 'any_one' THEN
      v_finalise := true;
      v_final_state := 'approved';
    ELSE
      -- all_must: count BLOCKING (is_blocking=true) active recipients only.
      -- B3 change: non-blocking reviewers do not count toward the quorum.
      -- Backward-safe: all pre-B3 recipients have is_blocking=true (DEFAULT).
      SELECT COUNT(*) INTO v_active_count
        FROM social_approval_recipients
       WHERE approval_request_id = v_recipient.approval_request_id
         AND revoked_at IS NULL
         AND is_blocking = true;

      SELECT COUNT(DISTINCT e.recipient_id) INTO v_approved_count
        FROM social_approval_events e
        JOIN social_approval_recipients r ON r.id = e.recipient_id
       WHERE e.approval_request_id = v_recipient.approval_request_id
         AND e.event_type = 'approved'
         AND r.revoked_at IS NULL
         AND r.is_blocking = true;

      IF v_active_count > 0 AND v_approved_count >= v_active_count THEN
        v_finalise := true;
        v_final_state := 'approved';
      END IF;
    END IF;
  END IF;

  IF v_finalise THEN
    UPDATE social_approval_requests
       SET final_approved_at = CASE
             WHEN v_final_state = 'approved' THEN v_now ELSE final_approved_at
           END,
           final_rejected_at = CASE
             WHEN v_final_state IN ('rejected', 'changes_requested') THEN v_now ELSE final_rejected_at
           END,
           final_approved_by_email = v_recipient.email,
           final_approved_by_name = v_recipient.name
     WHERE id = v_recipient.approval_request_id
       AND final_approved_at IS NULL
       AND final_rejected_at IS NULL
       AND revoked_at IS NULL
    RETURNING id INTO v_event_id;

    IF FOUND THEN
      v_finalised_now := true;
      UPDATE social_post_master
         SET state = v_final_state
       WHERE id = v_request.post_master_id
         AND state = 'pending_client_approval';
      v_post_state := v_final_state;
    ELSE
      SELECT state INTO v_post_state FROM social_post_master
       WHERE id = v_request.post_master_id;
    END IF;
  ELSE
    SELECT state INTO v_post_state FROM social_post_master
     WHERE id = v_request.post_master_id;
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_request.id,
    'post_id', v_request.post_master_id,
    'post_state', v_post_state,
    'finalised', v_finalised_now,
    'event_id', v_event_id
  );
END;
$$;

COMMENT ON FUNCTION record_approval_decision(UUID, social_approval_event_type, TEXT, INET, TEXT) IS
  'B3 update: quorum counts now filter AND is_blocking = true (non-blocking reviewers '
  'can comment/decide but do not affect finalization). All other logic unchanged. '
  'Backward-safe: existing recipients have DEFAULT is_blocking=true.';

-- ===========================================================================
-- 6. Extend social_approval_event_type enum (gatekeeper send-back)
-- ===========================================================================

ALTER TYPE social_approval_event_type ADD VALUE IF NOT EXISTS 'sent_back';

-- ===========================================================================
-- 7. Extend platform_notification_type enum (step-level events)
-- ===========================================================================

ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'proof_step_advanced';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'proof_sent_back';

-- ===========================================================================
-- 8. Extend platform_events.event_type CHECK (B3 step audit events)
-- ===========================================================================

ALTER TABLE platform_events
  DROP CONSTRAINT IF EXISTS platform_events_event_type_check;

ALTER TABLE platform_events
  ADD CONSTRAINT platform_events_event_type_check
    CHECK (event_type IN (
      -- Composer and draft lifecycle
      'compose_opened', 'compose_closed',
      'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
      -- Publishing lifecycle
      'publish_attempted',
      'publish_started', 'publish_succeeded', 'publish_failed',
      'publish_dead_lettered', 'publish_late', 'publish_rate_limited',
      -- AI
      'ai_generated', 'ai_failed',
      -- Connection lifecycle
      'connection_connected',
      'connection_broken', 'connection_expired', 'connection_pre_expiry',
      'connection_lost', 'connection_disconnected', 'connection_channel_overdue',
      -- Reconnect lifecycle
      'reconnect_required', 'reconnect_started', 'reconnect_completed',
      -- Cross-tenant identity
      'cross_tenant_blocked', 'cross_tenant_override', 'connection_reattributed',
      -- Notifications
      'notification_emitted',
      -- Approval lifecycle
      'approval_requested', 'approval_granted', 'approval_rejected',
      -- Proof lifecycle (B2)
      'proof_created', 'proof_version_created', 'proof_decision_made',
      'proof_approved', 'proof_revision_requested', 'reviewer_invited',
      -- Proof step lifecycle (B3)
      'proof_step_advanced', 'proof_step_sent_back',
      -- Scheduling lifecycle
      'schedule_created', 'schedule_due',
      'schedule_skipped', 'schedule_abandoned', 'schedule_blocked',
      -- Campaign lifecycle
      'campaign_created', 'campaign_started', 'campaign_post_dead_lettered',
      'campaign_completed', 'campaign_paused', 'campaign_resumed', 'campaign_cancelled',
      -- System lifecycle
      'worker_died',
      'webhook_dispatched', 'webhook_dispatch_failed', 'subscription_disabled',
      -- Magic link lifecycle (B1)
      'magic_link_issued', 'magic_link_consumed',
      'magic_link_revoked', 'magic_link_regenerated',
      -- Service
      'service_action_taken'
    ));

-- ===========================================================================
-- 9. Gate→step bridge (INSERT-only — lossless, no existing rows modified)
--
-- Dual-read strategy:
--   image_batch path: still reads company_workflow_gates (zero code changes)
--   content_proof path: reads workflow_steps (new engine)
--
-- Bridge creates workflow_steps ONLY for enabled gates that have approvers.
-- Order: copy_review→1, image_review→2, final_signoff→3.
-- ===========================================================================

INSERT INTO workflow_steps (company_id, step_order, name, pass_rule, timeout_days)
SELECT
  cwg.company_id,
  CASE cwg.gate_type
    WHEN 'copy_review'   THEN 1
    WHEN 'image_review'  THEN 2
    WHEN 'final_signoff' THEN 3
  END                  AS step_order,
  CASE cwg.gate_type
    WHEN 'copy_review'   THEN 'Copy review'
    WHEN 'image_review'  THEN 'Image review'
    WHEN 'final_signoff' THEN 'Final sign-off'
  END                  AS name,
  cwg.pass_rule,
  cwg.timeout_days
FROM company_workflow_gates cwg
WHERE cwg.enabled = true
  AND EXISTS (
    SELECT 1 FROM company_workflow_gate_approvers
     WHERE gate_id = cwg.id
  )
ON CONFLICT (company_id, step_order) DO NOTHING;

-- Bridge participants: gate approvers become step participants with role='approver'
INSERT INTO workflow_step_participants (step_id, platform_user_id, external_email, role)
SELECT
  ws.id,
  a.platform_user_id,
  a.external_email,
  'approver'
FROM workflow_steps ws
JOIN company_workflow_gates cwg
  ON  cwg.company_id = ws.company_id
  AND CASE cwg.gate_type
        WHEN 'copy_review'   THEN 1
        WHEN 'image_review'  THEN 2
        WHEN 'final_signoff' THEN 3
      END = ws.step_order
JOIN company_workflow_gate_approvers a ON a.gate_id = cwg.id
ON CONFLICT DO NOTHING;
