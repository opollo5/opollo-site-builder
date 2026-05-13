-- Rollback for migration 0124.
--
-- Postgres does not support DROP VALUE on an enum. This rollback is
-- intentionally a no-op. If you need to remove instagram_business:
--   1. Migrate all instagram_business rows to a suitable alternative.
--   2. Recreate the enum without the value (requires a full type swap).
-- For now, adding back a comment is the only safe statement here.

COMMENT ON TYPE social_platform IS
  'Platform enum for social_connections rows.';
