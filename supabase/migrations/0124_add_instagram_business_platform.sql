-- Add instagram_business to the social_platform enum.
--
-- Root cause of incident 2026-05-13-instagram-connect-does-nothing:
-- bundle.social returns socialAccounts with type="INSTAGRAM", but
-- BUNDLE_TO_PLATFORM in sync.ts had no entry for "INSTAGRAM", so every
-- Instagram OAuth completed with unmapped_skipped=1 and no DB row was
-- ever inserted. The missing enum value was the prerequisite blocker.
--
-- Postgres enum values are append-only (cannot DROP VALUE); the
-- corresponding rollback is a no-op comment.
--
-- Related TS changes: lib/platform/social/variants/types.ts,
-- lib/platform/social/connections/sync.ts,
-- lib/platform/social/connections/route-helpers.ts,
-- components/SocialConnectionsList.tsx,
-- app/api/platform/social/connections/identity-preflight/route.ts.

ALTER TYPE social_platform ADD VALUE IF NOT EXISTS 'instagram_business';

COMMENT ON TYPE social_platform IS
  'Platform enum for social_connections rows. instagram_business maps to '
  'bundle.social type INSTAGRAM (Facebook Graph API OAuth, Instagram Business '
  'pages). Added in migration 0124.';
