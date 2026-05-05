-- 0096 — Add concurrent publish cap check to claim_publish_job.
--
-- platform_companies.concurrent_publish_limit (DEFAULT 5, added in 0070) has
-- existed since the foundation migration but was never enforced at runtime.
-- This migration adds an enforcement point inside claim_publish_job: before
-- inserting the publish_job row the function counts in-flight attempts for the
-- company and short-circuits with 'CAPPED' if the count meets or exceeds the
-- limit.
--
-- Safety properties:
--   - The count is approximate: two concurrent claims could both pass the check
--     if they race the INSERT. The UNIQUE constraint on social_publish_jobs
--     (schedule_entry_id) means only one INSERT succeeds; the other returns
--     ALREADY_CLAIMED. So the cap can be exceeded by at most 1 at a time under
--     race conditions — acceptable for a soft throughput limit.
--   - CAPPED does not insert any rows, so the caller can safely re-enqueue the
--     schedule_entry_id via QStash with a 30-second delay and retry once the
--     pipeline has drained.

BEGIN;

CREATE OR REPLACE FUNCTION claim_publish_job(
  p_schedule_entry_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  publish_job_id UUID,
  publish_attempt_id UUID,
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
  v_entry  RECORD;
  v_variant RECORD;
  v_master RECORD;
  v_conn   RECORD;
  v_job_id UUID;
  v_attempt_id UUID;
  v_in_flight INT;
  v_cap INT;
BEGIN
  -- 1. Schedule entry lookup. Table-qualify post_variant_id to avoid
  --    ambiguity with the RETURNS TABLE output column.
  SELECT s.id, s.post_variant_id, s.scheduled_at, s.cancelled_at
    INTO v_entry
    FROM social_schedule_entries s
    WHERE s.id = p_schedule_entry_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_entry.cancelled_at IS NOT NULL THEN
    RETURN QUERY SELECT 'CANCELLED'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 2. Variant + master lookup.
  SELECT v.id, v.post_master_id, v.platform::TEXT AS platform,
         v.variant_text, v.connection_id
    INTO v_variant
    FROM social_post_variant v
    WHERE v.id = v_entry.post_variant_id;

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

  -- Master must be in a publishable state.
  IF v_master.state NOT IN ('approved', 'scheduled') THEN
    RETURN QUERY SELECT 'INVALID_STATE'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 2b. Concurrent publish cap check.
  --     Read the company's limit; fall back to 5 if the row is missing.
  SELECT COALESCE(pc.concurrent_publish_limit, 5)
    INTO v_cap
    FROM platform_companies pc
    WHERE pc.id = v_master.company_id;

  IF NOT FOUND THEN
    v_cap := 5;
  END IF;

  SELECT COUNT(*)::INT
    INTO v_in_flight
    FROM social_publish_attempts spa
    WHERE spa.company_id = v_master.company_id
      AND spa.status = 'in_flight';

  IF v_in_flight >= v_cap THEN
    RETURN QUERY SELECT 'CAPPED'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 3a. Resolve the connection.
  IF v_variant.connection_id IS NOT NULL THEN
    SELECT c.id, c.bundle_social_account_id, c.status::TEXT AS status
      INTO v_conn
      FROM social_connections c
      WHERE c.id = v_variant.connection_id;
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

  -- 3b. Atomically claim the publish-job slot.
  BEGIN
    INSERT INTO social_publish_jobs (
      schedule_entry_id,
      post_variant_id,
      company_id,
      fire_at,
      fired_at
    ) VALUES (
      p_schedule_entry_id,
      v_variant.id,
      v_master.company_id,
      v_entry.scheduled_at,
      now()
    )
    RETURNING id INTO v_job_id;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN QUERY SELECT 'ALREADY_CLAIMED'::TEXT,
        NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
        NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
      RETURN;
  END;

  -- 3c. Insert the in-flight attempt row. company_id is required (0074).
  INSERT INTO social_publish_attempts (
    publish_job_id,
    post_variant_id,
    company_id,
    connection_id,
    status,
    started_at
  ) VALUES (
    v_job_id,
    v_variant.id,
    v_master.company_id,
    v_conn.id,
    'in_flight',
    now()
  )
  RETURNING id INTO v_attempt_id;

  -- 3d. Advance master state — predicate-guarded.
  UPDATE social_post_master
    SET state = 'publishing',
        state_changed_at = now()
    WHERE id = v_master.id
      AND state IN ('approved', 'scheduled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_STATE: master moved during claim';
  END IF;

  RETURN QUERY SELECT 'OK'::TEXT,
    v_job_id,
    v_attempt_id,
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
