-- M2a — Link opollo_users to auth.users + auto-provision on signup
-- Reference: docs/m1-claude-code-brief.md §3.10 (opollo_users) + M2 plan thread.
--
-- Design decisions encoded here:
--
-- 1. opollo_users.id becomes a FK to auth.users(id) ON DELETE CASCADE. The
--    M1a table is empty (no rows were ever inserted), so no reconciliation
--    is needed. Every future opollo_users row is created by the trigger
--    below, one-for-one with auth.users.
--
-- 2. A trigger on auth.users AFTER INSERT auto-creates the matching
--    opollo_users row. Default role = 'viewer'. The one exception: if the
--    email matches the 'first_admin_email' entry in opollo_config, role =
--    'admin'. This is the bootstrap path — everybody else is promoted by
--    an admin through the M2d UI.
--
-- 3. A second trigger on auth.users AFTER UPDATE syncs email changes.
--    Without it, users who change their email in Supabase Auth would leave
--    opollo_users.email stale — harmless for FK integrity but misleading
--    in admin UIs.
--
-- 4. public.auth_role() is a SECURITY DEFINER helper that returns the
--    current user's role. M2b's RLS policies read it instead of duplicating
--    the opollo_users lookup in every policy clause.
--
-- 5. opollo_config is a tiny kv table for operator-supplied settings that
--    need to be readable from triggers (which can't see env vars). For M2a
--    it holds exactly one key — 'first_admin_email' — populated by the
--    scripts/sync-first-admin.ts CLI from the OPOLLO_FIRST_ADMIN_EMAIL env
--    var at deploy time. RLS service-role-only; no user access.

-- ----------------------------------------------------------------------------
-- opollo_config — operator-supplied DB-level settings
-- ----------------------------------------------------------------------------

CREATE TABLE opollo_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opollo_config ENABLE ROW LEVEL SECURITY;
-- TODO(M2b): no authenticated-role policy needed — this is internal config.
CREATE POLICY service_role_all ON opollo_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Link opollo_users.id → auth.users(id)
--
-- ON DELETE CASCADE: when an auth user is deleted, their opollo_users row
-- goes with them. Design-system / page rows that referenced the user via
-- created_by / last_edited_by were already ON DELETE SET NULL at the M1a
-- layer, so orphan audit traces don't disappear silently.
-- ----------------------------------------------------------------------------

ALTER TABLE opollo_users
  ADD CONSTRAINT opollo_users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- handle_new_auth_user — trigger fn on auth.users INSERT
--
-- SECURITY DEFINER because we're writing to public.opollo_users from a
-- trigger owned by the postgres role but fired by the auth schema's
-- service context. search_path pinned to public, auth so unqualified
-- references resolve predictably.
--
-- ON CONFLICT (id) DO NOTHING: defensive. If a future migration or manual
-- seed ever inserts an opollo_users row before auth.users sees it, the
-- trigger becomes a no-op rather than throwing.
-- ----------------------------------------------------------------------------

CREATE FUNCTION public.handle_new_auth_user()
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- handle_auth_user_email_update — keep opollo_users.email in sync
-- ----------------------------------------------------------------------------

CREATE FUNCTION public.handle_auth_user_email_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.opollo_users
    SET email = NEW.email
    WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_update
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.handle_auth_user_email_update();

-- ----------------------------------------------------------------------------
-- auth_role() — SECURITY DEFINER helper for M2b RLS policies
--
-- Returns the current session's role by looking up auth.uid() in
-- opollo_users. SECURITY DEFINER so policies don't have to grant SELECT on
-- opollo_users to every role that reads it. Returns NULL when called from
-- a context with no authenticated user (e.g. service-role operations or
-- anonymous requests) — policies that care branch on that.
-- ----------------------------------------------------------------------------

CREATE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.opollo_users WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.auth_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated, service_role;
