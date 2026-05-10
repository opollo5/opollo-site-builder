-- M-BSP1 — per-company bundle.social team isolation.
--
-- Each platform_companies row will hold its own bundle.social team id once
-- the provisioning helper has run (either on company creation or via the
-- backfill script). NULL means "not yet provisioned" — the provisioning
-- helper is idempotent and will create the team on the next request.
--
-- UNIQUE constraint covers non-NULL values only so that many unprovisioned
-- companies can coexist without a unique collision on NULL.

ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS bundle_social_team_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS platform_companies_bundle_social_team_id_key
  ON platform_companies (bundle_social_team_id)
  WHERE bundle_social_team_id IS NOT NULL;

COMMENT ON COLUMN platform_companies.bundle_social_team_id IS
  'bundle.social team id for this company (BSP-1 per-company isolation). '
  'NULL = not yet provisioned. Populated by getOrCreateBundleSocialTeam().';
