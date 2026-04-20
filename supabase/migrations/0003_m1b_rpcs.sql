-- M1b — RPCs for multi-step operations on the design system schema
-- Reference: docs/m1-claude-code-brief.md §3.3; M1b plan thread.
--
-- Purpose:
--   activate_design_system(ds_id, expected_version_lock) atomically:
--     1. Archives any currently-active design system for the same site.
--     2. Sets the target design system to 'active' and bumps its version_lock.
--   Both updates run inside a single SQL statement body, so either both apply
--   or neither does — the partial unique index one_active_design_system can
--   never observe two active rows for the same site.
--
-- Error semantics (surfaced to callers via RAISE):
--   - P0002 (no_data_found) if the target DS does not exist.
--   - VERSION_CONFLICT (SQLSTATE '40001') if expected_version_lock mismatch,
--     so the data layer can map it to the same ApiResponse as a row-level
--     optimistic-lock miss on a plain UPDATE.
--
-- Why SECURITY DEFINER:
--   RLS is service-role-only today (§M1a), so DEFINER is redundant with the
--   current policy set. It is set explicitly so M2's authenticated-role
--   policies don't accidentally break activation — the function runs with
--   the owner's privileges regardless of who calls it.

CREATE OR REPLACE FUNCTION activate_design_system(
  p_ds_id                 uuid,
  p_expected_version_lock integer
)
RETURNS design_systems
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id        uuid;
  v_current_lock   integer;
  v_result         design_systems;
BEGIN
  -- Resolve the target row and lock it for the duration of the transaction.
  SELECT site_id, version_lock
    INTO v_site_id, v_current_lock
    FROM design_systems
    WHERE id = p_ds_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'design_system % not found', p_ds_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_lock <> p_expected_version_lock THEN
    RAISE EXCEPTION
      'version_lock mismatch for design_system %: expected %, actual %',
      p_ds_id, p_expected_version_lock, v_current_lock
      USING ERRCODE = 'PT409';
    -- NOTE: using 'PT409' rather than '40001' (serialization_failure).
    -- supabase-js auto-retries 40001 under the postgres driver's
    -- serialization-failure contract, which turns a deterministic
    -- version-lock mismatch into a silent timeout. PT409 is recognised by
    -- PostgREST as a custom "HTTP 409 Conflict" signal — no retry, and
    -- the data layer's mapPgError() routes it straight to VERSION_CONFLICT.
  END IF;

  -- Archive any currently-active DS for this site (may be zero rows — the
  -- target itself might already be active and have no peer to archive).
  UPDATE design_systems
    SET status       = 'archived',
        archived_at  = now(),
        version_lock = version_lock + 1
    WHERE site_id = v_site_id
      AND status = 'active'
      AND id <> p_ds_id;

  -- Promote the target row.
  UPDATE design_systems
    SET status       = 'active',
        activated_at = coalesce(activated_at, now()),
        archived_at  = NULL,
        version_lock = version_lock + 1
    WHERE id = p_ds_id
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

-- Lock the function down — only roles that have rights on design_systems
-- should be able to invoke the activation RPC. service_role is the only
-- caller in M1.
REVOKE ALL ON FUNCTION activate_design_system(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_design_system(uuid, integer) TO service_role;
