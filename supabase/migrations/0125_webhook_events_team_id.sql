-- Migration 0125 — add team_id to social_webhook_events
--
-- Stores the bundle.social teamId from the webhook envelope alongside
-- each event row.  Needed for:
--   - Monitoring: detect teams that have gone silent (>24h no webhooks).
--   - Replay endpoint: filter by team when replaying unprocessed events.
--   - Debugging: join webhook events to connections via
--     platform_social_profiles.bundle_social_team_id.
--
-- Nullable — pre-existing rows and events that don't carry a teamId
-- (e.g. post.* events on older bundle.social versions) remain NULL.
-- The index is partial (WHERE team_id IS NOT NULL) to stay small.

ALTER TABLE social_webhook_events
  ADD COLUMN IF NOT EXISTS team_id TEXT;

CREATE INDEX IF NOT EXISTS idx_webhook_events_team_received
  ON social_webhook_events (team_id, received_at DESC)
  WHERE team_id IS NOT NULL;
