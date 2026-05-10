-- BSP-3 — multiple social profiles per company.
--
-- Today every platform_companies row holds a single bundle.social team id.
-- That model breaks the moment a company wants more than one social
-- presence — typical examples: "Brand Social" + "CEO personal" + "Sales
-- VP personal" — each of which needs its own bundle.social team because
-- bundle.social associates social accounts with teams, and one human's
-- LinkedIn personal account can't live in the same team as the brand's
-- LinkedIn company page.
--
-- This migration introduces platform_social_profiles, a per-company
-- 1:N collection of named profiles. Each profile carries its own
-- bundle.social team id (nullable until provisioned).
--
-- Backwards compatibility:
--   * platform_companies.bundle_social_team_id remains in place for
--     existing callers (BSP-2 dedup, contract tests, sync helpers).
--     Treated as the "default profile's team id" — kept in sync via
--     application code in BSP-5/6, dropped after callers migrate.
--   * Existing companies are backfilled: one default profile per
--     company carrying the company's existing team_id (if any).
--
-- RLS: company members read; opollo_staff and company admins write.
-- Mirrors the platform_company_users admin policy pattern from 0070.

CREATE TABLE platform_social_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- "company" for the brand profile, "executive" for personal-add-on
  -- profiles. Free-form for now; tighten to enum in a follow-up if needed.
  kind TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'executive')),
  -- Exactly one default profile per company (partial unique index below).
  -- The default profile is what the existing connect/sync code paths
  -- target when no profile_id is specified.
  is_default BOOLEAN NOT NULL DEFAULT false,
  -- bundle.social team id. NULL means "not yet provisioned" — same
  -- semantics as platform_companies.bundle_social_team_id.
  bundle_social_team_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Profile names must be unique within a company so users can refer
  -- to them by name in the admin UI without ambiguity.
  UNIQUE (company_id, name)
);

CREATE INDEX idx_platform_social_profiles_company
  ON platform_social_profiles(company_id);

-- Enforce: at most one default profile per company.
CREATE UNIQUE INDEX idx_platform_social_profiles_one_default_per_company
  ON platform_social_profiles(company_id)
  WHERE is_default = true;

-- Each bundle.social team belongs to at most one profile across the
-- whole platform. Mirrors the partial unique index on platform_companies
-- from migration 0116.
CREATE UNIQUE INDEX idx_platform_social_profiles_bundle_social_team_id
  ON platform_social_profiles(bundle_social_team_id)
  WHERE bundle_social_team_id IS NOT NULL;

COMMENT ON TABLE platform_social_profiles IS
  'BSP-3: per-company social profiles. Each profile owns one bundle.social '
  'team. Companies have exactly one default profile (used by legacy '
  'connect/sync paths) and 0..N additional profiles for executive '
  'add-ons or other distinct social presences.';

COMMENT ON COLUMN platform_social_profiles.bundle_social_team_id IS
  'bundle.social team id for this profile. NULL = not yet provisioned. '
  'Populated by getOrCreateBundleSocialTeamForProfile() in BSP-5.';

COMMENT ON COLUMN platform_social_profiles.is_default IS
  'Exactly one true per company (partial unique index). Default profile '
  'is what the existing /api/platform/social/connections/* endpoints '
  'target when no profile_id is specified.';

-- updated_at trigger — match the convention from 0070_platform_foundation.
CREATE TRIGGER platform_social_profiles_set_updated_at
  BEFORE UPDATE ON platform_social_profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- RLS: company members read; opollo_staff and company admins write.
ALTER TABLE platform_social_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_profiles_read ON platform_social_profiles FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY social_profiles_admin_write ON platform_social_profiles FOR ALL
  USING (is_opollo_staff() OR has_company_role(company_id, 'admin'))
  WITH CHECK (is_opollo_staff() OR has_company_role(company_id, 'admin'));

-- Backfill: every existing company gets one default profile. Carry over
-- the existing bundle_social_team_id where present.
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
