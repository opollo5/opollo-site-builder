-- =============================================================================
-- 0073 — Transactional cancel-approval function for social posts.
-- =============================================================================
-- Wraps the three writes S1-10 needs into one atomic SECURITY DEFINER
-- function so the invariant "a post that returns to draft has its
-- approval_request revoked + an audit event recorded" holds even
-- under concurrent cancellation attempts:
--   1. Verify the post is in 'pending_client_approval' for this company.
--   2. Atomically:
--        - UPDATE social_post_master state pending_client_approval → draft
--        - UPDATE social_approval_requests revoked_at = now() on the
--          single open row (if any)
--        - INSERT social_approval_events event_type='revoked' tied to
--          the request, with the actor's identity and the reason
--   3. RETURN the resulting state for the caller envelope.
--
-- Concurrency:
--   - The post UPDATE predicate (`state='pending_client_approval'`)
--     serialises concurrent cancels: only one transitions, the
--     others see 0 rows and we RAISE INVALID_STATE.
--   - Because the post UPDATE is the gate, the request revoke +
--     event INSERT only run after we've claimed the cancellation.
--     A reviewer's decision RPC arriving in the same window would
--     also predicate-guard on state='pending_client_approval'; one
--     wins, the other RAISEs.
--
-- Defensive cases:
--   - No open approval_request (post somehow in pending state with
--     no request): we still flip the post and return revoked=false +
--     event_id=null. Caller can decide whether to surface that.
--   - Multiple open approval_requests (data corruption — schema
--     doesn't enforce one-per-post): we revoke ALL of them, write
--     events for each. The RETURNING gives one event_id arbitrarily.
--     This shouldn't happen in normal flow.
-- =============================================================================

CREATE OR REPLACE FUNCTION cancel_post_approval(
  p_post_id        UUID,
  p_company_id     UUID,
  p_actor_user_id  UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request_id  UUID;
  v_event_id    UUID;
  v_revoked     BOOLEAN := false;
  v_post_exists BOOLEAN;
  v_clean_reason TEXT;
BEGIN
  v_clean_reason := NULLIF(TRIM(COALESCE(p_reason, '')), '');

  -- 1. Atomic post state flip. Predicate enforces:
  --    - belongs to this company
  --    - currently in pending_client_approval
  -- If 0 rows, we disambiguate (post not in company vs wrong state).
  WITH updated AS (
    UPDATE social_post_master
       SET state = 'draft'
     WHERE id = p_post_id
       AND company_id = p_company_id
       AND state = 'pending_client_approval'
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM updated) INTO v_post_exists;

  IF NOT v_post_exists THEN
    IF EXISTS (
      SELECT 1 FROM social_post_master
       WHERE id = p_post_id AND company_id = p_company_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'INVALID_STATE: post is not in pending_client_approval.';
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'NOT_FOUND: post not in this company.';
    END IF;
  END IF;

  -- 2. Revoke the open approval_request (if any). Defensive on the
  -- "multiple open" edge case — UPDATE all matches, write one event
  -- per match.
  FOR v_request_id IN
    UPDATE social_approval_requests
       SET revoked_at = now()
     WHERE post_master_id = p_post_id
       AND company_id = p_company_id
       AND revoked_at IS NULL
       AND final_approved_at IS NULL
       AND final_rejected_at IS NULL
    RETURNING id
  LOOP
    v_revoked := true;

    -- 3. Audit event for each revoked request. actor_user_id binds
    -- to the platform user who cancelled (not a magic-link recipient).
    INSERT INTO social_approval_events (
      approval_request_id, recipient_id, event_type,
      comment_text, actor_user_id, occurred_at
    )
    VALUES (
      v_request_id, NULL, 'revoked',
      v_clean_reason, p_actor_user_id, now()
    )
    RETURNING id INTO v_event_id;
  END LOOP;

  RETURN jsonb_build_object(
    'post_id', p_post_id,
    'post_state', 'draft',
    'revoked', v_revoked,
    'event_id', v_event_id
  );
END;
$$;

COMMENT ON FUNCTION cancel_post_approval(UUID, UUID, UUID, TEXT) IS
  'S1-10 — atomic cancel: flip post state pending_client_approval → draft, revoke any open approval_request, write a revoked event tied to the canceller. SQLSTATE P0001 = INVALID_STATE; P0002 = NOT_FOUND. SECURITY DEFINER; the route layer''s canDo(edit_post) gate is the authorisation.';
