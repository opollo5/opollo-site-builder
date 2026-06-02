-- ---------------------------------------------------------------------------
-- 0175_content_versioning_and_proof.sql
--
-- Introduces true content versioning on social_post_drafts and the
-- proof-lifecycle state machine. Also extends the approval backbone and
-- notification type system for the proofing subsystem (B2 Core Proofing V1).
--
-- VERSIONING SCHEMA:
--   content_group_id — stable UUID shared across all versions of one content
--                      item. Set explicitly on every insert; NOT NULL without
--                      a default after backfill (see Steven's amendment below).
--   version_number   — ordinal counter within the group; 1 = first version.
--   supersedes_id    — FK to the row this version replaces (null for v1).
--   proof_state      — per-version proof lifecycle state (3rd axis alongside
--                      `state` and `workflow_state`).
--
-- STEVEN'S AMENDMENT (content_group_id default strategy):
--   Step 1 — ADD COLUMN with DEFAULT so Postgres assigns a fresh UUID to every
--             existing row in a single statement (fast, lock-light).
--   Step 2 — DROP the DEFAULT immediately after backfill. Steady-state inserts
--             MUST provide content_group_id explicitly. A buggy v2-create path
--             that omits it fails with a loud NOT NULL violation rather than
--             silently orphaning the version into its own group.
--   The revision RPC (application layer) is the single sanctioned create-v2+
--   path; it always propagates content_group_id from the superseded row.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. content_group_id — backfill then drop default
-- ===========================================================================

ALTER TABLE social_post_drafts
  ADD COLUMN content_group_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Backfill is done; remove the default — steady-state inserts must name it.
ALTER TABLE social_post_drafts
  ALTER COLUMN content_group_id DROP DEFAULT;

-- ===========================================================================
-- 2. version_number — backfill all existing rows as v1
-- ===========================================================================

ALTER TABLE social_post_drafts
  ADD COLUMN version_number int NOT NULL DEFAULT 1;

ALTER TABLE social_post_drafts
  ALTER COLUMN version_number DROP DEFAULT;

-- ===========================================================================
-- 3. supersedes_id — self-referential FK; ON DELETE RESTRICT enforces
--    immutability (cannot physically delete a version referenced by a child).
-- ===========================================================================

ALTER TABLE social_post_drafts
  ADD COLUMN supersedes_id uuid REFERENCES social_post_drafts(id) ON DELETE RESTRICT;

-- Chain integrity: every version > 1 must reference its parent.
ALTER TABLE social_post_drafts
  ADD CONSTRAINT drafts_v2_needs_supersedes
    CHECK (version_number = 1 OR supersedes_id IS NOT NULL);

-- No self-referential cycles.
ALTER TABLE social_post_drafts
  ADD CONSTRAINT drafts_no_self_supersedes
    CHECK (supersedes_id IS DISTINCT FROM id);

-- ===========================================================================
-- 4. proof_state — per-version proof lifecycle (third state axis)
-- ===========================================================================

ALTER TABLE social_post_drafts
  ADD COLUMN proof_state text NOT NULL DEFAULT 'draft'
    CHECK (proof_state IN (
      'draft',             -- created, not yet submitted for review
      'in_review',         -- approval request open, reviewers notified
      'changes_requested', -- a reviewer requested changes; revision pending
      'in_revision',       -- a new version is being built (this version is superseded)
      'approved',          -- all required approvals received
      'published',         -- handed off to V2 publish path (state set to 'scheduled')
      'archived'           -- withdrawn or superseded; frozen immutable record
    ));

COMMENT ON COLUMN social_post_drafts.content_group_id IS
  'Stable identity shared across all versions of one content item. '
  'No DEFAULT in steady state — every insert must set this explicitly. '
  'Backfill assigns gen_random_uuid() to each existing draft (v1 of its own group).';

COMMENT ON COLUMN social_post_drafts.version_number IS
  'Ordinal version counter within a content_group. Starts at 1; increments '
  'on each revision. Must be set explicitly on insert (no default in steady state).';

COMMENT ON COLUMN social_post_drafts.supersedes_id IS
  'Points to the draft row this version replaces. NULL for v1. '
  'ON DELETE RESTRICT enforces immutability — physical deletion of a '
  'parent version is blocked; use archived_at for soft-delete.';

COMMENT ON COLUMN social_post_drafts.proof_state IS
  'Per-version proof lifecycle state. Independent of `state` (V2 publish path) '
  'and `workflow_state` (gate stage label from workflow engine).';

-- Fast lookup: "current active version(s) of a content group"
CREATE INDEX idx_drafts_content_group
  ON social_post_drafts(content_group_id, version_number DESC)
  WHERE archived_at IS NULL;

-- ===========================================================================
-- 5. Extend social_approval_requests.subject_type for content proofs
-- ===========================================================================
-- Drop + recreate the named CHECK constraint (same pattern as mig 0172 which
-- first added subject_type). Additive — no existing values removed.

ALTER TABLE social_approval_requests
  DROP CONSTRAINT IF EXISTS social_approval_requests_subject_type_check;

ALTER TABLE social_approval_requests
  ADD CONSTRAINT social_approval_requests_subject_type_check
    CHECK (subject_type IN ('image_batch', 'post_copy', 'post_final', 'content_proof'));

COMMENT ON COLUMN social_approval_requests.subject_type IS
  'Discriminator for the subject this approval covers. '
  'image_batch: image_generation_batches.id. '
  'post_copy / post_final: social_post_master.id (V1 pipeline). '
  'content_proof: social_post_drafts.content_group_id (V2 proofing pipeline).';

-- ===========================================================================
-- 6. Extend platform_notification_type enum for proofing events
-- ===========================================================================
-- ALTER TYPE ... ADD VALUE is non-transactional; each value is committed
-- independently. Same pattern used for image_generation_failed.

ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'proof_created';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'reviewer_invited';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'comment_added';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'new_version_created';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'proof_approved';

-- ===========================================================================
-- 7. Extend platform_events.event_type for proof audit events
-- ===========================================================================

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
      -- Proof lifecycle (B2)
      'proof_created', 'proof_version_created', 'proof_decision_made',
      'proof_approved', 'proof_revision_requested', 'reviewer_invited',
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
