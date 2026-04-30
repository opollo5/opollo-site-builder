-- 0058 — AUTH-FOUNDATION P3.2: transactional invite + audit Postgres functions.
--
-- The brief requires that every user-management action and its
-- corresponding user_audit_log row land in a SINGLE TRANSACTION — so
-- a successful invite_sent / invite_revoked / invite_accepted /
-- user_removed / role_changed action always has an audit row, and an
-- audit row never appears for an action that didn't land.
--
-- supabase-js doesn't expose connection-level BEGIN/COMMIT, so the
-- transactional surface goes through Postgres functions invoked via
-- supabase.rpc(). Each function does the action + audit insert
-- atomically.
--
-- Functions:
--   - create_invite(p_email, p_role, p_invited_by, p_token_hash,
--                   p_expires_at)
--       Inserts an invites row + invite_sent audit row.
--       Raises 'INVITE_PENDING_EXISTS' if a pending invite for the
--       email already exists (the partial unique index would also
--       block, but the function surfaces the error explicitly so
--       the API can return a clean 409).
--       Returns the invite id.
--
--   - revoke_invite(p_invite_id, p_actor_id)
--       Marks an invite revoked + writes invite_revoked audit row.
--       No-ops on already-terminal invites (returns false instead
--       of raising — the API surfaces this as a clean 409).
--
--   - accept_invite(p_invite_id, p_user_id, p_email)
--       Marks an invite accepted + writes invite_accepted audit row.
--       Used post-auth.users creation by the accept-invite route;
--       the auth.users creation is unavoidably outside this
--       transaction (Supabase admin API), but the invite-status flip
--       + audit row are atomic.
--       Returns true on success, false if the invite is no longer
--       pending (raced or already accepted).
--
-- All three functions are SECURITY DEFINER so the API doesn't need
-- to grant the anon/authenticated role direct INSERT on the
-- invites/audit tables. RLS policies on those tables stay
-- service-role-only.

-- ----------------------------------------------------------------------------
-- create_invite
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_invite(
  p_email       text,
  p_role        text,
  p_invited_by  uuid,
  p_token_hash  text,
  p_expires_at  timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_id uuid;
  v_actor_email text;
BEGIN
  -- Pre-check: surface a clean named exception when a pending
  -- invite already exists. The partial unique index catches the
  -- race; this just gives the API a typed failure string to match.
  IF EXISTS (
    SELECT 1 FROM invites
    WHERE email = p_email AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'INVITE_PENDING_EXISTS' USING
      DETAIL = format('A pending invite for %s already exists.', p_email);
  END IF;

  INSERT INTO invites (email, role, token_hash, invited_by, expires_at)
    VALUES (p_email, p_role, p_token_hash, p_invited_by, p_expires_at)
    RETURNING id INTO v_invite_id;

  -- Resolve actor email for the audit row's metadata column.
  SELECT email INTO v_actor_email
    FROM opollo_users WHERE id = p_invited_by;

  INSERT INTO user_audit_log (actor_id, action, target_email, metadata)
    VALUES (
      p_invited_by,
      'invite_sent',
      p_email,
      jsonb_build_object(
        'invite_id', v_invite_id,
        'role',      p_role,
        'expires_at', p_expires_at,
        'actor_email', v_actor_email
      )
    );

  RETURN v_invite_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- revoke_invite
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_invite(
  p_invite_id uuid,
  p_actor_id  uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_role  text;
BEGIN
  UPDATE invites
     SET status = 'revoked'
   WHERE id = p_invite_id
     AND status = 'pending'
   RETURNING email, role INTO v_email, v_role;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO user_audit_log (actor_id, action, target_email, metadata)
    VALUES (
      p_actor_id,
      'invite_revoked',
      v_email,
      jsonb_build_object('invite_id', p_invite_id, 'role', v_role)
    );

  RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- accept_invite
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_invite(
  p_invite_id uuid,
  p_user_id   uuid,
  p_email     text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  UPDATE invites
     SET status = 'accepted',
         accepted_at = now()
   WHERE id = p_invite_id
     AND status = 'pending'
     AND expires_at > now()
   RETURNING role INTO v_role;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Promote the auto-created opollo_users row (handle_new_auth_user
  -- inserted it with role='user' by default) to the invite's role.
  -- Skipped when the invite was for role='user' since the trigger
  -- already left them as user.
  IF v_role <> 'user' THEN
    UPDATE opollo_users
       SET role = v_role
     WHERE id = p_user_id;
  END IF;

  INSERT INTO user_audit_log (actor_id, action, target_email, metadata)
    VALUES (
      p_user_id,
      'invite_accepted',
      p_email,
      jsonb_build_object('invite_id', p_invite_id, 'role', v_role)
    );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.create_invite(text, text, uuid, text, timestamptz) IS
  'AUTH-FOUNDATION P3.2: transactional INSERT into invites + user_audit_log. Raises INVITE_PENDING_EXISTS on collision. SECURITY DEFINER. Added 2026-04-30.';
COMMENT ON FUNCTION public.revoke_invite(uuid, uuid) IS
  'AUTH-FOUNDATION P3.2: transactional UPDATE invites SET status=revoked + INSERT into user_audit_log. Returns false when the invite is no longer pending. SECURITY DEFINER. Added 2026-04-30.';
COMMENT ON FUNCTION public.accept_invite(uuid, uuid, text) IS
  'AUTH-FOUNDATION P3.2: transactional UPDATE invites SET status=accepted + role promotion + INSERT into user_audit_log. Returns false when the invite is no longer pending or has expired. SECURITY DEFINER. Added 2026-04-30.';
