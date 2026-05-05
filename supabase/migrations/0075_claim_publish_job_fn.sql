-- =============================================================================
-- 0075 — claim_publish_job(schedule_entry_id) — atomic publish-job claim.
--
-- S1-18 — When a QStash callback fires for a scheduled post, this
-- function:
--   1. Looks up the schedule_entry, ensures it's not cancelled.
--   2. Looks up the variant + master, ensures the master is in
--      'approved' or 'scheduled' state.
--   3. Atomically:
--      a. INSERTs a social_publish_jobs row keyed on schedule_entry_id
--         (UNIQUE partial index added below — first writer wins).
--      b. INSERTs a social_publish_attempts row with status='in_flight'.
--      c. Predicate-guarded UPDATE on social_post_master to
--         transition state → 'publishing'.
--   4. Returns the job_id, attempt_id, master/variant fields the caller
--      needs to compose the bundle.social postCreate request.
--
-- Concurrent fires (QStash redelivery, manual retry) race at the
-- INSERT in step 3a — second writer hits the UNIQUE violation and
-- gets 'ALREADY_CLAIMED'. Master state guard (step 3c) covers
-- the case where someone manually advanced the post out of
-- approved/scheduled before the QStash callback fired.
--
-- Caller is responsible for verifying the QStash signature before
-- calling this RPC. The function itself trusts its input.
-- =============================================================================

BEGIN;

-- Add a UNIQUE INDEX so concurrent claims race deterministically.
-- Partial because schedule_entry_id is nullable (ON DELETE SET NULL on
-- the FK) — we don't want every NULL row to collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_publish_jobs_schedule_entry
  ON social_publish_jobs(schedule_entry_id)
  WHERE schedule_entry_id IS NOT NULL;

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
BEGIN
  -- 1. Schedule entry lookup.
  SELECT id, post_variant_id, scheduled_at, cancelled_at
    INTO v_entry
    FROM social_schedule_entries
    WHERE id = p_schedule_entry_id;

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

  -- Master must be in a publishable state. Anything else (rejected,
  -- already-published, manually pushed back to draft) means we should
  -- NOT publish — bundle.social call would be wasted spend.
  IF v_master.state NOT IN ('approved', 'scheduled') THEN
    RETURN QUERY SELECT 'INVALID_STATE'::TEXT,
      NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID,
      NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 3a. Resolve the connection. The variant may have a pinned
  -- connection_id, otherwise fall back to the first healthy connection
  -- for this platform on the master's company.
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

  -- 3b. Atomically claim the publish-job slot. UNIQUE on
  -- schedule_entry_id (added by this migration) makes this a hard
  -- racing point: second concurrent fire raises 23505 → ALREADY_CLAIMED.
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

  -- 3c. Insert the in-flight attempt row.
  INSERT INTO social_publish_attempts (
    publish_job_id,
    post_variant_id,
    connection_id,
    status,
    started_at
  ) VALUES (
    v_job_id,
    v_variant.id,
    v_conn.id,
    'in_flight',
    now()
  )
  RETURNING id INTO v_attempt_id;

  -- 3d. Advance master state — predicate-guarded so manual interventions
  -- between steps 2 and 3d don't get steamrolled. The state check at
  -- step 2 already passed but the master may have moved while we were
  -- inserting the job/attempt; if so, abort by raising INVALID_STATE
  -- so the caller treats the attempt as orphaned (it'll be marked
  -- failed by the cleanup path).
  UPDATE social_post_master
    SET state = 'publishing',
        state_changed_at = now()
    WHERE id = v_master.id
      AND state IN ('approved', 'scheduled');

  IF NOT FOUND THEN
    -- Race: master moved out of approved/scheduled between step 2 and
    -- step 3d. Roll the inserts back by raising — the calling
    -- transaction (this RPC) gets aborted automatically.
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
