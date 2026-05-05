-- =============================================================================
-- 0094 — Fix v_master_updated type in retry_publish_attempt.
--
-- Migrations 0091 and 0092 declared v_master_updated as BOOLEAN, but
-- GET DIAGNOSTICS ... = ROW_COUNT returns BIGINT. PostgreSQL has no
-- assignment cast from bigint to boolean, so the GET DIAGNOSTICS line
-- throws a runtime error for every happy-path call (refusal-case tests
-- return before reaching the UPDATE, masking the bug). Fix: INTEGER.
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
  v_master_updated INTEGER;
BEGIN
  -- 1. Attempt lookup. Use alias 'a' to avoid ambiguity with the RETURNS
  --    TABLE output column `publish_job_id`.
  SELECT a.id, a.publish_job_id, a.post_variant_id, a.connection_id,
         a.status::TEXT AS status, a.retry_count
    INTO v_attempt
    FROM social_publish_attempts a
    WHERE a.id = p_attempt_id;

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

  -- 2. Job lookup. Use alias 'j' to avoid ambiguity with `post_variant_id`
  --    in the RETURNS TABLE signature.
  SELECT j.id, j.post_variant_id, j.company_id
    INTO v_job
    FROM social_publish_jobs j
    WHERE j.id = v_attempt.publish_job_id;

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

  IF v_master.state <> 'failed' THEN
    RETURN QUERY SELECT 'INVALID_STATE'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 3. Resolve the connection.
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

  -- 4a. Atomically advance master state.
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

  -- 4b. Insert the new in-flight attempt.
  INSERT INTO social_publish_attempts (
    publish_job_id,
    post_variant_id,
    connection_id,
    company_id,
    status,
    original_attempt_id,
    retry_count,
    started_at
  ) VALUES (
    v_job.id,
    v_variant.id,
    v_conn.id,
    v_master.company_id,
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
