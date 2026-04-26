-- ---------------------------------------------------------------------------
-- 0024 — soft-delete RLS leakage fix.
--
-- AUDIT.md (2026-04-26) §3 RLS spot-check, soft-delete leakage findings.
-- Promoted from MEDIUM to HIGH on 2026-04-27 by the fix-pass review —
-- UAT testers deleting and restoring content is exactly the surface that
-- catches this.
--
-- Five user-facing read policies (briefs, brief_pages, brief_runs,
-- site_conventions, posts) authorize on role only — they do NOT filter
-- `deleted_at IS NULL`. Soft-deleted rows therefore stay visible to any
-- authenticated user via direct SELECT against the table. The application
-- layer (lib/posts.ts, lib/briefs.ts) does filter by `deleted_at IS NULL`
-- on its happy paths, but those use the service-role client which bypasses
-- RLS entirely — the protective filter is at the app layer, not the DB.
-- A direct authenticated query (e.g. via supabase-js client.from("posts").
-- select()) bypasses the app layer and exposes everything.
--
-- Fix: drop + recreate each read policy with the same role check, plus
-- `AND deleted_at IS NULL`. Admin-recovery surfaces that need to see
-- soft-deleted rows must use the service-role client (which they already
-- do for the happy path).
--
-- Tables affected:
--   - briefs            (0013:325-327)
--   - brief_pages       (0013:339-341)
--   - brief_runs        (0013:353-355)
--   - site_conventions  (0013:367-369)
--   - posts             (0019:178-180)
-- ---------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS briefs_read ON briefs;
CREATE POLICY briefs_read ON briefs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin', 'operator', 'viewer')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS brief_pages_read ON brief_pages;
CREATE POLICY brief_pages_read ON brief_pages
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin', 'operator', 'viewer')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS brief_runs_read ON brief_runs;
CREATE POLICY brief_runs_read ON brief_runs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin', 'operator', 'viewer')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS site_conventions_read ON site_conventions;
CREATE POLICY site_conventions_read ON site_conventions
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin', 'operator', 'viewer')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS posts_read ON posts;
CREATE POLICY posts_read ON posts
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('admin', 'operator', 'viewer')
    AND deleted_at IS NULL
  );

COMMIT;
