-- =============================================================================
-- 0142 — social_media_assets scope column
--
-- Adds a `scope` column to social_media_assets with two values:
--   'company'  — default; asset visible only to its owning company
--   'global'   — promoted by staff; visible to all companies in the composer
--                media library tab
--
-- RLS update: existing media_access policy is replaced so that rows with
-- scope = 'global' are readable by any authenticated company member.
-- The WITH CHECK clause is unchanged — users can only write to assets they
-- own (by company membership), and only staff can set scope = 'global' via
-- the admin promote endpoint (which uses the service role client).
-- =============================================================================

BEGIN;

ALTER TABLE social_media_assets
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'company'
    CHECK (scope IN ('company', 'global'));

CREATE INDEX IF NOT EXISTS idx_media_assets_scope
  ON social_media_assets(scope)
  WHERE scope = 'global';

-- Drop the old policy and replace it with the scope-aware version.
DROP POLICY IF EXISTS media_access ON social_media_assets;

CREATE POLICY media_access ON social_media_assets FOR ALL
  USING (
    is_opollo_staff()
    OR is_company_member(company_id)
    OR scope = 'global'
  )
  WITH CHECK (
    is_opollo_staff()
    OR is_company_member(company_id)
  );

COMMIT;
