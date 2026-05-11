-- Cross-tenant identity-leak defence — incident
-- docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md.
--
-- The reported leak: a person who authorises bundle.social for the same
-- platform across multiple companies in one browser session ends up
-- attached to each company's bundle.social team without re-prompting,
-- because the platform-side OAuth provider (LinkedIn observed; behaviour
-- is generic across providers) silently auto-approves the repeat grant.
-- Our DB stores each as a distinct bundle.social account id, but the
-- underlying platform identity is identical.
--
-- This migration captures the platform-side identity fingerprint per
-- connection. Layer 2 (lib/platform/social/connections/identity.ts)
-- queries the indexes below to refuse cross-tenant / cross-profile
-- attachments at every write point.
--
-- Per-platform identity columns:
--   external_account_id — the platform's account / page / channel id
--   (urn:li:organization for LinkedIn pages, FB page id, IG account id,
--   YouTube channel id, GBP location id, etc.). Some platforms expose
--   this as `externalId` from socialAccountGetByType; others need a
--   per-platform projection. The identity lib normalises.
--
--   external_user_id — the platform's identity of the human who granted
--   OAuth. For LinkedIn this is the urn:li:person; for FB the FB user
--   id (NOT the page id); for YouTube the Google account; for TikTok/X/
--   threads/etc. this is the account id and external_user_id == external_account_id.
--
--   external_identity_hash — md5(platform || ':' || account_id || ':'
--   || user_id), computed in TS on every insert/update. The single index
--   the cross-tenant detector queries; platform-agnostic O(1) lookup.

ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS external_account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS external_identity_hash TEXT NULL;

COMMENT ON COLUMN social_connections.external_account_id IS
  'Platform-side account/page/channel id (urn:li:organization, FB Page id, '
  'IG account id, YouTube channel id, GBP location id, etc.). Populated '
  'from socialAccountGetByType.externalId. Used by the cross-tenant '
  'identity-leak defence — see docs/architecture/SOCIAL_CONNECTIONS_IDENTITY_MODEL.md.';

COMMENT ON COLUMN social_connections.external_user_id IS
  'Platform-side identity of the human who granted OAuth (LinkedIn person, '
  'FB user, Google account, etc.). May differ from external_account_id on '
  'platforms with Page-like sub-channels (FB, IG, YouTube, GBP). Populated '
  'from socialAccountGetByType.userId.';

COMMENT ON COLUMN social_connections.external_identity_hash IS
  'md5(platform || '':'' || external_account_id || '':'' || external_user_id). '
  'Computed in TypeScript on insert/update by computeIdentityHash. NULL when '
  'either identity column is NULL (connection in pending_identity state). '
  'Indexed; the cross-tenant detector hits this index.';

CREATE INDEX IF NOT EXISTS social_connections_identity_hash_idx
  ON social_connections (external_identity_hash)
  WHERE external_identity_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_connections_external_account_idx
  ON social_connections (platform, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS social_connections_external_user_idx
  ON social_connections (platform, external_user_id)
  WHERE external_user_id IS NOT NULL;

-- New 'pending_identity' status for connections whose external_account_id
-- or external_user_id is NULL after socialAccountGetByType — typically
-- platforms with a channel/page selection step that the user hasn't yet
-- completed. Publishing must refuse these (the existing claim_publish_job
-- RPC at supabase/migrations/0096 already gates on status='healthy', so
-- adding pending_identity here automatically blocks publishing).
ALTER TYPE social_connection_status ADD VALUE IF NOT EXISTS 'pending_identity' AFTER 'disconnected';

-- Operator override on platform_companies. When TRUE, Layer 2's
-- cross-tenant block logs a warning and proceeds. Settable only via
-- the admin maintenance tool (Layer 4); every override fires an audit
-- entry in platform_events with kind='cross_tenant_override'.
ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS allow_cross_tenant_identity BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN platform_companies.allow_cross_tenant_identity IS
  'When TRUE, the cross-tenant identity-leak defence logs a warning '
  'instead of blocking attachments where another company already owns '
  'the same external identity. Operator-only; toggle via /admin/'
  'maintenance/social-connections. Every override is audited in '
  'platform_events with event_type=''cross_tenant_override''.';

-- Extend the platform_events event_type CHECK constraint to admit
-- the three new audit event types this defence emits.
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
    -- Cross-tenant identity-leak defence (this migration).
    'cross_tenant_blocked',
    'cross_tenant_override',
    'connection_reattributed'
  ));
