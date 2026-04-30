-- Rollback for 0063_auth_foundation_roles_and_invites.sql.
--
-- Caveats:
--   - The role rename viewer→user / operator→admin is data-lossy on
--     the way back: there's no record of which 'user' rows were
--     originally 'viewer'. This rollback maps user→viewer for ALL
--     non-super_admin / non-admin rows; if you had genuine 'admin'
--     rows that came from operator promotions, they stay as admin.
--   - The super_admin trigger guard is dropped, so hi@opollo.com is
--     once again deletable.
--   - invites + user_audit_log rows are dropped along with their
--     tables — this is intentional; their data only makes sense
--     under the P3 schema.

DROP TABLE IF EXISTS user_audit_log;
DROP TABLE IF EXISTS invites;

DROP TRIGGER IF EXISTS guard_super_admin_trigger ON opollo_users;
DROP FUNCTION IF EXISTS public.guard_super_admin();

-- Restore the original handle_new_auth_user (admin / viewer).
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
    v_role := 'admin';
  ELSE
    v_role := 'viewer';
  END IF;

  INSERT INTO public.opollo_users (id, email, role)
    VALUES (NEW.id, NEW.email, v_role)
    ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Restore the role enum (admin / operator / viewer).
ALTER TABLE opollo_users
  DROP CONSTRAINT IF EXISTS opollo_users_role_check;

UPDATE opollo_users SET role = 'viewer' WHERE role = 'user';
UPDATE opollo_users SET role = 'admin' WHERE role = 'super_admin';
-- 'admin' rows that were originally 'operator' stay as 'admin' — no
-- way to disambiguate post-rollback.

ALTER TABLE opollo_users
  ADD CONSTRAINT opollo_users_role_check
    CHECK (role IN ('admin', 'operator', 'viewer'));

ALTER TABLE opollo_users
  ALTER COLUMN role SET DEFAULT 'viewer';
