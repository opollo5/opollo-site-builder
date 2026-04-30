-- 0057 — AUTH-FOUNDATION P3: super_admin tier + role rename + invites + audit log.
--
-- Replaces the legacy three-role enum (admin, operator, viewer) with the
-- AUTH-FOUNDATION brief's three-role enum (super_admin, admin, user) and
-- lays the schema for the custom invite + audit-log flows that supersede
-- the existing Supabase magic-link invite path.
--
-- Changes:
--
-- 1. opollo_users.role:
--      - DROP old CHECK (admin | operator | viewer)
--      - ADD new CHECK (super_admin | admin | user)
--      - Map existing rows:
--          viewer  → user        (1:1)
--          operator → admin       (consolidate; operators were already
--                                  trusted-but-not-supreme)
--          admin   → admin        (kept, will be auto-promoted to
--                                  super_admin below for hi@opollo.com)
--      - DEFAULT to 'user' (handle_new_auth_user trigger still sets
--        super_admin / user explicitly via opollo_config; the column
--        default is the safety net for direct inserts that bypass the
--        trigger)
--
-- 2. handle_new_auth_user trigger updated:
--      - first_admin_email → super_admin (was admin)
--      - everyone else     → user (was viewer)
--
-- 3. opollo_config.first_admin_email upserted to 'hi@opollo.com'
--    (canonical super_admin per the brief)
--
-- 4. opollo_users row for hi@opollo.com upserted with role='super_admin'
--    so the existing bootstrap admin is preserved at the top tier even
--    if they were created before this migration ran.
--
-- 5. New trigger guard_super_admin: prevents DELETE on the
--    hi@opollo.com row, and prevents UPDATE that changes the role
--    away from 'super_admin' OR changes the email. This is the
--    DB-level "super_admin cannot be removed" enforcement from the
--    brief.
--
-- 6. invites table: per-invite tracking with token_hash (sha-256 of
--    a 32-byte random; raw token only sent in email, never stored).
--    24-hour expiry; status enum (pending | accepted | expired |
--    revoked); invited_by FK to opollo_users.
--
-- 7. user_audit_log table: append-only audit of user-management
--    actions. Writes happen IN THE SAME TRANSACTION as the action
--    (enforced at the application layer via supabase.from(...).insert
--    + supabase.from('user_audit_log').insert in a wrapped routine).
--
-- Forward-only. The app code in lib/auth.ts + lib/admin-gate.ts
-- updates in lockstep with this migration so main stays green.

-- ----------------------------------------------------------------------------
-- 1. opollo_users.role enum migration
-- ----------------------------------------------------------------------------

-- Drop the old CHECK first so the data migration below doesn't trip it.
ALTER TABLE opollo_users
  DROP CONSTRAINT IF EXISTS opollo_users_role_check;

-- Map legacy roles. operator → admin (work-day operators continue to
-- have the admin powers they had); viewer → user (no admin access);
-- admin stays admin (super_admin promotion happens below).
UPDATE opollo_users SET role = 'user'  WHERE role = 'viewer';
UPDATE opollo_users SET role = 'admin' WHERE role = 'operator';

-- Re-add the CHECK with the new enum.
ALTER TABLE opollo_users
  ADD CONSTRAINT opollo_users_role_check
    CHECK (role IN ('super_admin', 'admin', 'user'));

-- Default 'user' for direct inserts that bypass the trigger.
ALTER TABLE opollo_users
  ALTER COLUMN role SET DEFAULT 'user';

COMMENT ON COLUMN opollo_users.role IS
  'AUTH-FOUNDATION P3 enum (added 2026-04-30). super_admin: hi@opollo.com only, undeletable, all powers. admin: invite/remove role=user, no promotions. user: no /admin access. The handle_new_auth_user trigger sets super_admin for the first_admin_email config value and user for everyone else.';

-- ----------------------------------------------------------------------------
-- 2. handle_new_auth_user trigger update
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_first_admin_email text;
  v_role              text;
BEGIN
  SELECT value
    INTO v_first_admin_email
    FROM public.opollo_config
    WHERE key = 'first_admin_email';

  IF v_first_admin_email IS NOT NULL AND NEW.email = v_first_admin_email THEN
    v_role := 'super_admin';
  ELSE
    v_role := 'user';
  END IF;

  INSERT INTO public.opollo_users (id, email, role)
    VALUES (NEW.id, NEW.email, v_role)
    ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. opollo_config.first_admin_email upsert + super_admin row promotion
-- ----------------------------------------------------------------------------

INSERT INTO opollo_config (key, value)
  VALUES ('first_admin_email', 'hi@opollo.com')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- If hi@opollo.com already has an opollo_users row (e.g. they were
-- created via the previous bootstrap as 'admin'), promote them.
UPDATE opollo_users
   SET role = 'super_admin'
 WHERE email = 'hi@opollo.com';

-- ----------------------------------------------------------------------------
-- 4. guard_super_admin trigger — DB-level "super_admin cannot be removed"
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_super_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- DELETE: block if the row is the hi@opollo.com super_admin.
  IF (TG_OP = 'DELETE') THEN
    IF OLD.email = 'hi@opollo.com' AND OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'SUPER_ADMIN_LOCKED: hi@opollo.com cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: block role change OR email change on the super_admin row.
  IF (TG_OP = 'UPDATE') THEN
    IF OLD.email = 'hi@opollo.com' AND OLD.role = 'super_admin' THEN
      IF NEW.role <> 'super_admin' THEN
        RAISE EXCEPTION 'SUPER_ADMIN_LOCKED: hi@opollo.com role cannot be changed';
      END IF;
      IF NEW.email <> OLD.email THEN
        RAISE EXCEPTION 'SUPER_ADMIN_LOCKED: hi@opollo.com email cannot be changed';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_super_admin_trigger ON opollo_users;
CREATE TRIGGER guard_super_admin_trigger
  BEFORE UPDATE OR DELETE ON opollo_users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_super_admin();

-- ----------------------------------------------------------------------------
-- 5. invites table
-- ----------------------------------------------------------------------------

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  role         text NOT NULL
    CHECK (role IN ('admin', 'user')),  -- never invite to super_admin
  token_hash   text NOT NULL UNIQUE,    -- sha256 of 32-byte random; raw token only ever in email
  invited_by   uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  accepted_at  timestamptz,
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

-- Inbox-style queries (operator views pending invites for an email,
-- accept-invite endpoint looks up by token_hash).
CREATE INDEX invites_email_status_idx ON invites (email, status);
CREATE INDEX invites_status_expires_idx ON invites (status, expires_at);

-- Partial unique: at most one pending invite per email at a time.
-- Accepted / expired / revoked rows don't block future invites.
CREATE UNIQUE INDEX invites_pending_email_uniq
  ON invites (email)
  WHERE status = 'pending';

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON invites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE invites IS
  'AUTH-FOUNDATION P3 invite tracking. token_hash is sha256 of a 32-byte random; the raw token only ever appears in the invite email. 24-hour expiry by default. Added 2026-04-30 (P3.1).';

-- ----------------------------------------------------------------------------
-- 6. user_audit_log table
-- ----------------------------------------------------------------------------

CREATE TABLE user_audit_log (
  id            bigserial PRIMARY KEY,
  actor_id      uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  action        text NOT NULL
    CHECK (action IN (
      'invite_sent',
      'invite_revoked',
      'invite_accepted',
      'user_removed',
      'user_reinstated',
      'role_changed'
    )),
  target_email  text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_audit_log_created_idx
  ON user_audit_log (created_at DESC);

CREATE INDEX user_audit_log_target_idx
  ON user_audit_log (target_email, created_at DESC);

CREATE INDEX user_audit_log_actor_idx
  ON user_audit_log (actor_id, created_at DESC);

ALTER TABLE user_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON user_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE user_audit_log IS
  'AUTH-FOUNDATION P3 user-management audit. Append-only; writes happen in the same transaction as the action (enforced at the application layer). Read by the /admin/users/audit super-admin viewer. Added 2026-04-30 (P3.1).';
