-- ---------------------------------------------------------------------------
-- 0174_magic_links.sql
--
-- Generic magic-link service table. Backs approval, login, and reconnect
-- link issuance. External reviewer sessions live on this row:
--   consumed_at        = timestamp of first click (one-time use marker)
--   session_expires_at = consumed_at + purpose-specific TTL (≤24h for approval)
--
-- platform_session_grants stays untouched — authenticated users only (B4).
-- ---------------------------------------------------------------------------

CREATE TABLE magic_links (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose             text        NOT NULL
                        CHECK (purpose IN ('approval', 'login', 'reconnect')),
  token_hash          text        NOT NULL,
  subject_type        text,                   -- 'approval_recipient' | 'user' | 'social_connection'
  subject_id          uuid,                   -- row this link acts on
  company_id          uuid        REFERENCES platform_companies(id) ON DELETE CASCADE,
  email               text,
  expires_at          timestamptz NOT NULL,   -- link click window
  consumed_at         timestamptz,            -- first click; sets session
  session_expires_at  timestamptz,            -- end of ≤24h session window (null until consumed)
  revoked_at          timestamptz,
  regenerated_from    uuid        REFERENCES magic_links(id),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT magic_links_token_hash_unique
    UNIQUE (token_hash),
  -- session_expires_at must not be set without a consumed_at
  CONSTRAINT magic_links_session_requires_consume
    CHECK (session_expires_at IS NULL OR consumed_at IS NOT NULL)
);

-- Hot path: validate/consume lookup filtered to active links
CREATE INDEX idx_magic_links_token_hash
  ON magic_links(token_hash)
  WHERE revoked_at IS NULL;

-- Revoke by subject (e.g. when a recipient is removed)
CREATE INDEX idx_magic_links_subject
  ON magic_links(subject_type, subject_id)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

-- Rate-limit re-request: latest link per email+purpose
CREATE INDEX idx_magic_links_email_purpose
  ON magic_links(email, purpose, created_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE magic_links ENABLE ROW LEVEL SECURITY;

-- Service role has full access (validate/consume are service-role operations)
CREATE POLICY magic_links_service_role ON magic_links
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Operators can read their company's links (for audit and resend UI)
CREATE POLICY magic_links_company_read ON magic_links
  FOR SELECT
  USING (
    is_opollo_staff()
    OR (company_id IS NOT NULL AND is_company_member(company_id))
  );

COMMENT ON TABLE magic_links IS
  'Generic one-time tokens for approval, login, and reconnect flows. '
  'consumed_at = first click; session_expires_at = end of ≤24h session window. '
  'platform_session_grants handles authenticated-user sessions (B4).';

COMMENT ON COLUMN magic_links.session_expires_at IS
  'Null until first click. Set to consumed_at + purpose-specific TTL (≤24h). '
  'Allows a reviewer to return within the same session without a new link.';

-- ---------------------------------------------------------------------------
-- Tie approval recipients to their magic link row (nullable — existing
-- rows keep working; new issuances set this FK for the service lookups).
-- ---------------------------------------------------------------------------

ALTER TABLE social_approval_recipients
  ADD COLUMN magic_link_id uuid REFERENCES magic_links(id);

CREATE INDEX idx_approval_recipients_magic_link_id
  ON social_approval_recipients(magic_link_id)
  WHERE magic_link_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Extend platform_events event_type to include magic-link audit events.
-- Drop + recreate the named constraint (mirrors mig 0126 pattern).
-- ---------------------------------------------------------------------------

ALTER TABLE platform_events
  DROP CONSTRAINT IF EXISTS platform_events_event_type_check;

ALTER TABLE platform_events
  ADD CONSTRAINT platform_events_event_type_check
    CHECK (event_type IN (
      -- Composer and draft lifecycle
      'compose_opened', 'compose_closed',
      'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
      -- Publishing lifecycle
      'publish_attempted',
      'publish_started', 'publish_succeeded', 'publish_failed',
      'publish_dead_lettered',
      'publish_late',
      'publish_rate_limited',
      -- AI
      'ai_generated', 'ai_failed',
      -- Connection lifecycle
      'connection_connected',
      'connection_broken', 'connection_expired', 'connection_pre_expiry',
      'connection_lost', 'connection_disconnected', 'connection_channel_overdue',
      -- Reconnect lifecycle
      'reconnect_required',
      'reconnect_started', 'reconnect_completed',
      -- Cross-tenant identity (migration 0122)
      'cross_tenant_blocked', 'cross_tenant_override', 'connection_reattributed',
      -- Notifications
      'notification_emitted',
      -- Approval lifecycle
      'approval_requested', 'approval_granted', 'approval_rejected',
      -- Scheduling lifecycle
      'schedule_created', 'schedule_due',
      'schedule_skipped', 'schedule_abandoned', 'schedule_blocked',
      -- Campaign lifecycle
      'campaign_created', 'campaign_started', 'campaign_post_dead_lettered',
      'campaign_completed', 'campaign_paused', 'campaign_resumed', 'campaign_cancelled',
      -- System lifecycle
      'worker_died',
      'webhook_dispatched', 'webhook_dispatch_failed', 'subscription_disabled',
      -- Magic link lifecycle (mig 0174)
      'magic_link_issued', 'magic_link_consumed',
      'magic_link_revoked', 'magic_link_regenerated',
      -- Service
      'service_action_taken'
    ));
