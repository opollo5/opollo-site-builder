-- Migration 0156: Add bundle_post_id to social_post_drafts.
--
-- Needed so the insights source-attribution traversal (lib/insights/source-attribution.ts)
-- can resolve V2 posts directly without falling back to the V1 chain.
--
-- The V2 publish cron (app/api/internal/cron/publish-due/route.ts) calls
-- bundle.social and receives externalId in the response. This column stores that
-- value so resolvePostSource can short-circuit to draft.source_type instead of
-- traversing social_publish_attempts → social_post_variant → social_post_master.
--
-- Nullable: existing V2 drafts published before this migration will show NULL and
-- naturally fall through to the V1 chain (which returns 'composer' for those rows).
--
-- Index: partial index covering non-NULL rows only — the column is NULL for
-- drafts not yet published, so a full index would waste space.
--
-- Rollback: DROP INDEX IF EXISTS idx_social_post_drafts_bundle_post_id;
--           ALTER TABLE social_post_drafts DROP COLUMN IF EXISTS bundle_post_id;

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS bundle_post_id TEXT;

CREATE INDEX IF NOT EXISTS idx_social_post_drafts_bundle_post_id
  ON social_post_drafts (bundle_post_id)
  WHERE bundle_post_id IS NOT NULL;
