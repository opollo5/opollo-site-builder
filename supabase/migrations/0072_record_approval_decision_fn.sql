-- =============================================================================
-- 0072 — Transactional approval-decision recorder.
-- =============================================================================
-- Wraps the four writes S1-7 needs into one atomic SECURITY DEFINER
-- function so the invariant "the post's state, the request's
-- finalisation timestamps, and the events log all agree" holds even
-- under concurrent decisions:
--   1. Verify the recipient is still active (not revoked) and the
--      parent request is still open (not revoked, not finalised).
--   2. Verify this recipient hasn't already lodged a decision —
--      one decision per recipient per request, idempotent on retry.
--   3. INSERT the social_approval_events row.
--   4. Apply the rule:
--        - any rejection / changes_requested → finalise the request
--          immediately (final_rejected_at, post.state = 'rejected'
--          or 'changes_requested')
--        - approved + rule='any_one' → finalise approved
--        - approved + rule='all_must' → only finalise if every
--          ACTIVE recipient has approved (revoked recipients don't
--          count toward the quorum)
--
-- Concurrency:
--   - Steps 1-2 read; step 3 writes; step 4 conditionally updates.
--     plpgsql wraps the whole body in an implicit txn so two parallel
--     decisions that both want to finalise the request will serialise
--     on the UPDATE social_approval_requests row. The second one
--     sees the first's final_*_at already set and would normally
--     skip the finalisation; we re-check via the row-version
--     equivalent (`WHERE final_approved_at IS NULL AND
--     final_rejected_at IS NULL`) so the second UPDATE is a no-op
--     rather than overwriting the first decision.
--   - Step 4's post-state update is also predicated on
--     `WHERE state = 'pending_client_approval'` so a parallel admin
--     revocation can't get clobbered.
--
-- SQLSTATEs:
--   P0001 INVALID_STATE — recipient revoked, request finalised, or
--                         this recipient already decided.
--   P0002 NOT_FOUND     — recipient missing.
-- =============================================================================

CREATE OR REPLACE FUNCTION record_approval_decision(
  p_recipient_id UUID,
  -- Must be one of: 'approved', 'rejected', 'changes_requested'.
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
  -- Decision must be one of the recognised terminal event types.
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
    -- Should be impossible (FK), but defensive.
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

  -- 2. Idempotency: this recipient must not have already decided.
  IF EXISTS (
    SELECT 1 FROM social_approval_events
     WHERE recipient_id = p_recipient_id
       AND event_type IN ('approved', 'rejected', 'changes_requested')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'INVALID_STATE: this reviewer already lodged a decision.';
  END IF;

  -- 3. INSERT the event. bound_identity_email/name come from the
  -- recipient row (set at add time). actor_user_id stays null for
  -- external reviewers; will be set by a later slice when the
  -- recipient is a platform user signed-in via Supabase Auth.
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
    -- Cast via TEXT — Postgres won't auto-cast between two distinct
    -- enum types even when their string values match. This is a
    -- one-shot conversion: only 'rejected' and 'changes_requested'
    -- exist in BOTH enums, and we've gated to those two values.
    v_final_state := p_decision::text::social_post_state;
  ELSIF p_decision = 'approved' THEN
    IF v_request.approval_rule = 'any_one' THEN
      v_finalise := true;
      v_final_state := 'approved';
    ELSE
      -- all_must: count active (non-revoked) recipients on this
      -- request, count approve events. If equal, finalise.
      SELECT COUNT(*) INTO v_active_count
        FROM social_approval_recipients
       WHERE approval_request_id = v_recipient.approval_request_id
         AND revoked_at IS NULL;

      SELECT COUNT(DISTINCT e.recipient_id) INTO v_approved_count
        FROM social_approval_events e
        JOIN social_approval_recipients r ON r.id = e.recipient_id
       WHERE e.approval_request_id = v_recipient.approval_request_id
         AND e.event_type = 'approved'
         AND r.revoked_at IS NULL;

      IF v_active_count > 0 AND v_approved_count >= v_active_count THEN
        v_finalise := true;
        v_final_state := 'approved';
      END IF;
    END IF;
  END IF;

  IF v_finalise THEN
    -- Atomically finalise the request. Predicate ensures we don't
    -- overwrite a parallel decision that finalised first; in that
    -- race the second caller's event has already been inserted
    -- (audit) but the request stays bound to the first decision.
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
    RETURNING id INTO v_event_id; -- reuse var; if no row updated v_event_id stays as-is

    IF FOUND THEN
      v_finalised_now := true;
      -- Flip post state. Same predicate-guarded UPDATE: only
      -- transition out of pending_client_approval. If a parallel
      -- admin already moved it (e.g. via a separate emergency
      -- override slice — none today, but defence in depth), we
      -- don't clobber.
      UPDATE social_post_master
         SET state = v_final_state
       WHERE id = v_request.post_master_id
         AND state = 'pending_client_approval';
      v_post_state := v_final_state;
    ELSE
      -- Lost the finalisation race. Read the actual current state.
      SELECT state INTO v_post_state FROM social_post_master
       WHERE id = v_request.post_master_id;
    END IF;
  ELSE
    -- Not finalising (all_must mode, partial approvals).
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
  'S1-7 — atomic decision recording: insert social_approval_events row, evaluate the approval_rule, finalise the request, flip post state. SQLSTATE P0001 = INVALID_STATE; P0002 = NOT_FOUND. SECURITY DEFINER because the route calls via service-role; token verification gates the call.';
