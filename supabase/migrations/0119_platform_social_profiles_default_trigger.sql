-- BSP-5 fix — auto-create a default platform_social_profiles row for every
-- new platform_companies row.
--
-- Migration 0118 backfilled defaults for companies that already existed at
-- migration time, but did NOT cover companies inserted later. That meant:
--
--   * Companies created via /api/admin/companies after 0118 ran have no
--     default profile, breaking every downstream surface that calls
--     listProfilesForCompany.
--   * The e2e suite's seed helper (global-setup) inserts its e2e
--     customer company at test-prep time — also missing a default.
--
-- This trigger closes both gaps by making the "exactly one default
-- profile per company" invariant a structural property rather than an
-- application-level convention.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running the trigger on
-- a row that already has a default (e.g., reseeded test) is a no-op.

CREATE OR REPLACE FUNCTION platform_companies_create_default_profile()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_social_profiles (
    company_id,
    name,
    kind,
    is_default,
    bundle_social_team_id
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.name, 'Brand Social'),
    'company',
    true,
    NEW.bundle_social_team_id
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION platform_companies_create_default_profile() IS
  'BSP-5: ensures every platform_companies row has at least one default '
  'platform_social_profiles row. Idempotent via ON CONFLICT DO NOTHING — '
  'tests reseeding a company will not double-up.';

DROP TRIGGER IF EXISTS platform_companies_default_profile
  ON platform_companies;

CREATE TRIGGER platform_companies_default_profile
  AFTER INSERT ON platform_companies
  FOR EACH ROW
  EXECUTE FUNCTION platform_companies_create_default_profile();

-- Top-up backfill: any companies inserted between 0118 running and this
-- migration applying still need a default. Same shape as the 0118 backfill.
INSERT INTO platform_social_profiles (
  company_id,
  name,
  kind,
  is_default,
  bundle_social_team_id
)
SELECT
  c.id,
  COALESCE(c.name, 'Brand Social'),
  'company',
  true,
  c.bundle_social_team_id
FROM platform_companies c
WHERE NOT EXISTS (
  SELECT 1 FROM platform_social_profiles p
  WHERE p.company_id = c.id AND p.is_default = true
);
