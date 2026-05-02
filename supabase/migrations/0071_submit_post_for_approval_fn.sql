-- =============================================================================
-- 0071 — Transactional submit-for-approval function for social posts.
-- =============================================================================
-- Wraps the two writes that S1-5 needs:
--   1. UPDATE social_post_master SET state='pending_client_approval'
--      WHERE id=p_post_id AND company_id=p_company_id AND state='draft'
--   2. INSERT INTO social_approval_requests with the snapshot payload
--
-- Doing both in one Postgres function makes them atomic: either both
-- happen or neither does. The alternative — two PostgREST calls in
-- application code — leaves a window where the state has flipped but
-- the approval_request hasn't landed (or vice versa), breaking the
-- invariant "every pending_client_approval post has exactly one open
-- approval_request".
--
-- Concurrency:
--   - The state predicate (`state='draft'`) gives us optimistic locking.
--     Two concurrent submits both UPDATE; the second affects 0 rows
--     and we RAISE EXCEPTION with SQLSTATE P0001.
--   - Caller-side retries on P0001 are a no-op (state already moved).
--
-- Snapshot:
--   - Caller passes the snapshot pre-built (master_text + per-platform
--     variants array). The function does NOT recompute it from current
--     rows — that would race with concurrent variant edits inside the
--     same transaction window.
--   - approval_rule defaults to platform_companies.approval_default_rule.
--   - expires_at is caller-supplied (default ~+14d at the lib layer).
-- =============================================================================

CREATE OR REPLACE FUNCTION submit_post_for_approval(
  p_post_id    UUID,
  p_company_id UUID,
  p_snapshot   JSONB,
  p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule social_approval_rule;
  v_request_id UUID;
  v_updated_id UUID;
BEGIN
  -- 1. Atomic transition. Predicate enforces draft + correct company.
  -- A row missing OR a row not in the right company OR not in 'draft'
  -- all trip the same RAISE — caller can't distinguish "no such post"
  -- from "post in wrong state" via the SQLSTATE alone, so we encode
  -- the precise error in MESSAGE for the lib to parse.
  UPDATE social_post_master
     SET state = 'pending_client_approval'
   WHERE id = p_post_id
     AND company_id = p_company_id
     AND state = 'draft'
   RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    -- Disambiguate: did the post exist at all in this company?
    IF EXISTS (
      SELECT 1 FROM social_post_master
       WHERE id = p_post_id AND company_id = p_company_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'INVALID_STATE: post is not in draft.';
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'NOT_FOUND: post not in this company.';
    END IF;
  END IF;

  -- 2. Resolve the company's approval rule. Function rather than a
  -- subquery so we can RAISE if the company is missing (defence-in-
  -- depth — the FK from posts already prevents orphans).
  SELECT approval_default_rule INTO v_rule
    FROM platform_companies
   WHERE id = p_company_id;

  IF v_rule IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'NOT_FOUND: company missing.';
  END IF;

  -- 3. INSERT the approval_request bound to this post + this snapshot.
  -- snapshot_payload is immutable post-insert per the schema comment;
  -- callers must NOT update it later.
  INSERT INTO social_approval_requests (
    post_master_id, company_id, approval_rule,
    snapshot_payload, expires_at
  )
  VALUES (
    p_post_id, p_company_id, v_rule,
    p_snapshot, p_expires_at
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

COMMENT ON FUNCTION submit_post_for_approval(UUID, UUID, JSONB, TIMESTAMPTZ) IS
  'S1-5 — atomic state flip (draft → pending_client_approval) plus the matching approval_request insert. SQLSTATE P0001 = INVALID_STATE; P0002 = NOT_FOUND. SECURITY DEFINER because the lib calls this via service-role; canDo gating happens at the route layer.';
