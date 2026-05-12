-- Rollback for 0123_social_connections_channel_selection.sql.
--
-- Removes the two boolean columns and reverts the platform_events
-- event_type CHECK to its post-0122 shape.

ALTER TABLE social_connections
  DROP COLUMN IF EXISTS is_personal_mode,
  DROP COLUMN IF EXISTS has_emitted_overdue_event;

ALTER TABLE platform_events
  DROP CONSTRAINT IF EXISTS platform_events_event_type_check;

ALTER TABLE platform_events
  ADD CONSTRAINT platform_events_event_type_check
  CHECK (event_type IN (
    'compose_opened', 'compose_closed',
    'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
    'publish_started', 'publish_succeeded', 'publish_failed',
    'ai_generated', 'ai_failed',
    'reconnect_started', 'reconnect_completed',
    'connection_broken', 'connection_expired', 'connection_pre_expiry',
    'notification_emitted',
    'approval_requested', 'approval_granted', 'approval_rejected',
    'cross_tenant_blocked',
    'cross_tenant_override',
    'connection_reattributed'
  ));
