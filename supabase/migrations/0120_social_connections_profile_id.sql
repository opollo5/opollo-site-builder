-- BSP-8 — attribute social_connections to a platform_social_profiles row.
--
-- Until now, social_connections was scoped to a company only. With
-- per-profile teams (BSP-6), a connection lives inside a specific
-- bundle.social team, which belongs to a specific profile. Adding
-- profile_id closes the gap so the customer-facing connections UI
-- can filter per profile, and so the sync flow can attribute new
-- connections to the right profile rather than to the company at
-- large.
--
-- ON DELETE SET NULL — if a profile is deleted (BSP-5 deleteProfile,
-- which already protects the default profile from deletion), its
-- non-default connections become unattributed but aren't lost. The
-- next sync re-resolves attribution.

ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS profile_id UUID NULL
    REFERENCES platform_social_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_connections_profile
  ON social_connections(profile_id)
  WHERE profile_id IS NOT NULL;

COMMENT ON COLUMN social_connections.profile_id IS
  'BSP-8: profile that owns this connection. NULL = unattributed '
  '(legacy or post-delete). Backfill maps existing rows to the '
  'company''s default profile.';

-- Backfill: every existing social_connections row gets attributed to
-- its company's default profile. Migration 0119''s trigger guarantees
-- every company has exactly one default, so this is well-defined.
UPDATE social_connections sc
SET profile_id = sp.id
FROM platform_social_profiles sp
WHERE sp.company_id = sc.company_id
  AND sp.is_default = true
  AND sc.profile_id IS NULL;
