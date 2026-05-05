-- =============================================================================
-- 0077 — social_media_assets bundle.social cache columns.
--
-- S1-22 — adds the columns needed to attach media to publish_attempts:
--   source_url           — public HTTPS URL of the asset (for V1's
--                          uploadCreateFromUrl path; future slices can
--                          also support Supabase Storage download +
--                          uploadCreate Blob).
--   bundle_upload_id     — bundle.social's upload id for this asset.
--                          Cached after first upload so retries (and
--                          repeated uses across posts) don't re-upload.
--   bundle_uploaded_at   — when the cache was populated. Used to expire
--                          stale ids if bundle.social ever rotates them
--                          (their docs don't pin a TTL — V1 treats the
--                          cache as permanent).
--
-- Partial index on (company_id, bundle_upload_id) so the resolveByCache
-- lookup is fast.
-- =============================================================================

BEGIN;

ALTER TABLE social_media_assets
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS bundle_upload_id TEXT,
  ADD COLUMN IF NOT EXISTS bundle_uploaded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_media_assets_bundle_upload
  ON social_media_assets(company_id, bundle_upload_id)
  WHERE bundle_upload_id IS NOT NULL;

COMMIT;
