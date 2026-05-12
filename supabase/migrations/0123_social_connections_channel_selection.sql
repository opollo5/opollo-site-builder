-- LinkedIn channel-selection flow — incident
-- docs/incidents/2026-05-12-linkedin-connect-flow-broken.md.
--
-- The reported gap: bundle.social's channel-selection platforms
-- (LINKEDIN, FACEBOOK, INSTAGRAM, YOUTUBE, GOOGLE_BUSINESS) require a
-- second SDK call after OAuth completes — POST set-channel — to bind
-- the freshly-created socialAccount to a specific org / page / channel
-- / location. Until that call lands, channels[] is empty on the
-- bundle.social side and publishing fails. We never made that call;
-- our DB wrongly marked these connections 'healthy' because the SDK's
-- externalId+userId are populated even with empty channels[].
--
-- This migration adds the two flags the new flow needs and extends
-- the platform_events CHECK to admit the new audit event types.
--
-- See also lib/platform/social/connections/channels.ts.

ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS is_personal_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_emitted_overdue_event BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN social_connections.is_personal_mode IS
  'LinkedIn and future personal-profile platforms: user explicitly chose '
  'to connect their personal profile rather than picking a company page. '
  'Status is ''healthy'' but bundle.social channels[] is empty. Set by '
  '/api/platform/social/connections/:id/connect-as-personal.';

COMMENT ON COLUMN social_connections.has_emitted_overdue_event IS
  'Idempotency flag for the connection_channel_overdue audit event. '
  'Flips to true the first time the customer-facing connections page '
  'renders the >24h overdue banner for this connection, so the event '
  'is emitted exactly once.';

-- Extend the platform_events event_type CHECK constraint to admit the
-- two new audit event types the channel-selection flow emits.
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
    -- Cross-tenant identity-leak defence (migration 0122).
    'cross_tenant_blocked',
    'cross_tenant_override',
    'connection_reattributed',
    -- Channel-selection flow (this migration).
    'connection_channel_overdue',
    'connection_disconnected'
  ));
