-- =============================================================================
-- 0076 — retry_publish_attempt(publish_attempt_id) — operator-triggered retry.
--
-- S1-20 — When a publish_attempt landed in status='failed', an operator
-- can hit the retry endpoint to:
--   1. Validate the attempt is still in 'failed' (not already retried).
--   2. Validate the master is still in 'failed' (operator might have
--      manually pushed it back to draft / published it externally).
--   3. Atomically:
--      a. UPDATE master state 'failed' → 'publishing' (predicate-
--         guarded; 0 rows = ALREADY_RETRYING — another operator
--         beat us).
--      b. INSERT new social_publish_attempts row tied to the same
--         publish_job, status='in_flight', original_attempt_id =
--         the failed attempt's id, retry_count = prev + 1.
--   4. Return the new attempt id + composition fields the caller
--      needs to build the bundle.social postCreate request.
--
-- Concurrent retries race at step 3a — second writer sees 0 rows
-- updated and gets ALREADY_RETRYING. The new attempt is NOT inserted
-- in that case (we return before step 3b).
--
-- Caller is responsible for canDo("schedule_post", company_id) +
-- verifying the operator owns the company. Function trusts its input.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION retry_publish_attempt(
  p_attempt_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  publish_attempt_id UUID,
  publish_job_id UUID,
  post_master_id UUID,
  post_variant_id UUID,
  company_id UUID,
  platform TEXT,
  variant_text TEXT,
  master_text TEXT,
  link_url TEXT,
  bundle_social_account_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt RECORD;
  v_job     RECORD;
  v_variant RECORD;
  v_master  RECORD;
  v_conn    RECORD;
  v_new_attempt_id UUID;
  v_master_updated BOOLEAN;
BEGIN
  -- 1. Attempt lookup.
  SELECT id, publish_job_id, post_variant_id, connection_id,
         status::TEXT AS status, retry_count
    INTO v_attempt
    FROM social_publish_attempts
    WHERE id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_attempt.status <> 'failed' THEN
    RETURN QUERY SELECT 'INVALID_STATE'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 2. Job + variant + master lookups.
  SELECT id, post_variant_id, company_id
    INTO v_job
    FROM social_publish_jobs
    WHERE id = v_attempt.publish_job_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT v.id, v.post_master_id, v.platform::TEXT AS platform,
         v.variant_text, v.connection_id
    INTO v_variant
    FROM social_post_variant v
    WHERE v.id = v_attempt.post_variant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  SELECT m.id, m.company_id, m.master_text, m.link_url, m.state::TEXT AS state
    INTO v_master
    FROM social_post_master m
    WHERE m.id = v_variant.post_master_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Master must be in 'failed'. If operator already manually pushed
  -- it back to draft, or it's somehow re-published externally, refuse
  -- to retry — bundle.social call would be wasted spend or duplicate
  -- the post.
  IF v_master.state <> 'failed' THEN
    RETURN QUERY SELECT 'INVALID_STATE'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 3. Resolve the connection. Same fallback rule as
  -- claim_publish_job: pinned connection_id wins, otherwise first
  -- healthy connection for this platform on the company.
  IF v_attempt.connection_id IS NOT NULL THEN
    SELECT c.id, c.bundle_social_account_id, c.status::TEXT AS status
      INTO v_conn
      FROM social_connections c
      WHERE c.id = v_attempt.connection_id;
  ELSE
    SELECT c.id, c.bundle_social_account_id, c.status::TEXT AS status
      INTO v_conn
      FROM social_connections c
      WHERE c.company_id = v_master.company_id
        AND c.platform = v_variant.platform::social_platform
        AND c.status = 'healthy'
      ORDER BY c.connected_at DESC
      LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NO_CONNECTION'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_conn.status <> 'healthy' THEN
    RETURN QUERY SELECT 'CONNECTION_DEGRADED'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 4a. Atomically advance master state. This is the lock: two
  -- concurrent retries race here, second one sees 0 rows updated
  -- and bails with ALREADY_RETRYING before the INSERT in 4b.
  UPDATE social_post_master
    SET state = 'publishing',
        state_changed_at = now()
    WHERE id = v_master.id
      AND state = 'failed';

  GET DIAGNOSTICS v_master_updated = ROW_COUNT;
  IF v_master_updated = 0 THEN
    RETURN QUERY SELECT 'ALREADY_RETRYING'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 4b. Insert the new in-flight attempt, linking to the failed one
  -- via original_attempt_id and bumping retry_count.
  INSERT INTO social_publish_attempts (
    publish_job_id,
    post_variant_id,
    connection_id,
    status,
    original_attempt_id,
    retry_count,
    started_at
  ) VALUES (
    v_job.id,
    v_variant.id,
    v_conn.id,
    'in_flight',
    v_attempt.id,
    COALESCE(v_attempt.retry_count, 0) + 1,
    now()
  )
  RETURNING id INTO v_new_attempt_id;

  RETURN QUERY SELECT 'OK'::TEXT,
    v_new_attempt_id,
    v_job.id,
    v_master.id,
    v_variant.id,
    v_master.company_id,
    v_variant.platform,
    v_variant.variant_text,
    v_master.master_text,
    v_master.link_url,
    v_conn.bundle_social_account_id;
END;
$$;

COMMIT;
