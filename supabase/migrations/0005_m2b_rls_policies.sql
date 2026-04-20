-- M2b — User-scoped RLS policies
-- Reference: docs/m1-claude-code-brief.md §2.6 (not written yet) + M2 plan
-- thread. Also opollo5/opollo-site-builder PR #13 description.
--
-- Design decisions encoded here:
--
-- 1. Two policies per RW table: <table>_read (FOR SELECT, all three roles)
--    and <table>_write (FOR ALL, admin + operator only). `FOR ALL` on the
--    write policy covers SELECT redundantly for admin/operator — under
--    Postgres's permissive-OR semantics that's a no-op for correctness,
--    and it keeps the policy count to 2 per table instead of 4.
--
-- 2. opollo_users is the only table whose self-read carve-out makes
--    identity (not role) the gate. opollo_users_self_read uses
--    `id = auth.uid() OR public.auth_role() = 'admin'` — admin reads any
--    row; everyone else reads only their own. opollo_users_admin_write is
--    admin-only for all non-read ops (including role promotion, which is
--    M2d's mechanism).
--
-- 3. auth_role() is the M2a helper that returns the current user's role
--    from opollo_users, keyed by auth.uid(). It's SECURITY DEFINER with
--    SET search_path = public (see 0004_m2a_auth_link.sql:141-146) so
--    policies on opollo_users don't recurse: the function bypasses RLS
--    to do its lookup. pg_temp is deliberately excluded from the
--    search_path to prevent the well-known shadowing attack on
--    SECURITY DEFINER functions.
--
-- 4. service_role_all policies from M1/M2a stay in place on every table.
--    Service-role callers (existing API routes via getServiceRoleClient,
--    the auth.users trigger, the M2c emergency-bypass route) continue to
--    bypass user-scoped RLS entirely. The M1 integration tests use
--    service-role and shouldn't break.
--
-- 5. opollo_config (from M2a) gets no new policies. Service-role-only
--    access is correct — the first_admin_email bootstrap value must not
--    be readable by authenticated users. Leaving it unreachable from
--    REST closes the obvious enumeration path.

-- ----------------------------------------------------------------------------
-- sites
-- ----------------------------------------------------------------------------

CREATE POLICY sites_read ON sites
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY sites_write ON sites
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- design_systems
-- ----------------------------------------------------------------------------

CREATE POLICY design_systems_read ON design_systems
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY design_systems_write ON design_systems
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- design_components
-- ----------------------------------------------------------------------------

CREATE POLICY design_components_read ON design_components
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY design_components_write ON design_components
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- design_templates
-- ----------------------------------------------------------------------------

CREATE POLICY design_templates_read ON design_templates
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY design_templates_write ON design_templates
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- pages
-- ----------------------------------------------------------------------------

CREATE POLICY pages_read ON pages
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY pages_write ON pages
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- opollo_users
--
-- self_read: non-admins read only their own row; admin reads everyone.
-- admin_write: admin-only INSERT / UPDATE / DELETE. Non-admins write
-- nothing — no policy matches, RLS denies.
-- ----------------------------------------------------------------------------

CREATE POLICY opollo_users_self_read ON opollo_users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.auth_role() = 'admin');

CREATE POLICY opollo_users_admin_write ON opollo_users
  FOR ALL TO authenticated
  USING      (public.auth_role() = 'admin')
  WITH CHECK (public.auth_role() = 'admin');
