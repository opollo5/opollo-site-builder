-- =============================================================================
-- 0104 — Add company_id to sites table + backfill orphaned sites.
--
-- Root cause fix for Issue #2: sites had no company association, causing
-- 7+ orphaned sites with no company_id. This migration:
--   1. Adds company_id (nullable FK) to sites.
--   2. Backfills all existing sites without company_id to the Opollo Internal
--      company (is_opollo_internal = true). If no internal company exists,
--      sites remain NULL (no data is deleted; constraint applied later once
--      all sites are assigned).
--   3. Adds an index for company-scoped site queries.
--   4. Records this backfill in platform_data_migrations for audit trail.
--
-- Write-safety:
--   - Backfill uses UPDATE ... WHERE company_id IS NULL (idempotent; safe
--     to re-run if the migration was partially applied).
--   - NOT NULL constraint is intentionally deferred until a follow-up
--     migration confirms all environments have an Opollo Internal company.
--   - RLS policy added so platform users can read sites scoped to their
--     company (service_role retains full access).
-- =============================================================================

-- 1. Add company_id column (nullable — enforced NOT NULL in follow-up once backfill confirmed).
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS company_id uuid
  REFERENCES platform_companies(id) ON DELETE SET NULL;

-- 2. Backfill all sites that have no company_id → assign to Opollo Internal.
--    Uses a DO block so it's idempotent and skips gracefully if no internal company exists.
DO $$
DECLARE
  v_internal_id uuid;
  v_affected     integer;
BEGIN
  -- Find the Opollo Internal company.
  SELECT id INTO v_internal_id
    FROM platform_companies
   WHERE is_opollo_internal = true
   LIMIT 1;

  IF v_internal_id IS NULL THEN
    RAISE NOTICE '0104: No Opollo Internal company found. Skipping backfill. Create one and re-run manually.';
    RETURN;
  END IF;

  -- Assign all sites without a company to Opollo Internal.
  UPDATE sites
     SET company_id = v_internal_id,
         updated_at = now()
   WHERE company_id IS NULL
     AND status != 'removed';

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  RAISE NOTICE '0104: Assigned % orphaned site(s) to Opollo Internal (company_id = %)', v_affected, v_internal_id;

  -- Record in platform_data_migrations audit table (best-effort; skip if table not present).
  BEGIN
    INSERT INTO platform_data_migrations (migration_name, table_name, records_affected, notes)
    VALUES (
      '0104_backfill_sites_company_id',
      'sites',
      v_affected,
      jsonb_build_object('opollo_internal_id', v_internal_id, 'reason', 'Issue #2: orphaned sites assigned to Opollo Internal')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '0104: Could not write to platform_data_migrations: %', SQLERRM;
  END;
END $$;

-- 3. Index for company-scoped queries (e.g. "get all sites for company X").
CREATE INDEX IF NOT EXISTS idx_sites_company_id
  ON sites (company_id)
  WHERE company_id IS NOT NULL AND status != 'removed';

-- 4. RLS policy — platform users read their company's sites.
--    Service role already has unrestricted access (existing policy).
DROP POLICY IF EXISTS platform_company_member_read ON sites;
CREATE POLICY platform_company_member_read ON sites
  FOR SELECT
  TO authenticated
  USING (
    company_id IS NOT NULL
    AND company_id IN (
      SELECT company_id FROM platform_company_users
       WHERE user_id = (
         SELECT id FROM platform_users WHERE auth_user_id = auth.uid()
       )
         AND deleted_at IS NULL
    )
  );
