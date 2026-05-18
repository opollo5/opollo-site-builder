-- Migration 0134: analytics cache + approval decisions log
-- Cold/historical analytics layer (Upstash Redis is the hot cache).
-- Approval decisions audit log.
-- See docs/briefs/social-01/composer/SCHEMA.md §5, §6
--
-- CLAUDE-ASSUMPTION: brief defined auth.user_belongs_to_company() but:
--   (a) migration role cannot CREATE in auth schema
--   (b) is_company_member(UUID) from 0070 is the exact working analog
-- Using is_company_member() directly — no new function needed.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- social_post_analytics_cache
-- ─────────────────────────────────────────────────────────────
CREATE TABLE social_post_analytics_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  impressions       integer,
  engagement_rate   numeric(5, 2),
  reactions         integer,
  shares            integer,
  comments          integer,
  clicks            integer,
  platform_specific jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_social_post_analytics_cache_draft_id_fetched_at
  ON social_post_analytics_cache(draft_id, fetched_at DESC);

ALTER TABLE social_post_analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_company ON social_post_analytics_cache
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = social_post_analytics_cache.draft_id
        AND is_company_member(d.company_id)
    )
  );

-- INSERT/UPDATE allowed only via service role (QStash analytics worker) — no public policy

-- ─────────────────────────────────────────────────────────────
-- social_post_approval_decisions
-- ─────────────────────────────────────────────────────────────
CREATE TABLE social_post_approval_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  approver_user_id  uuid NOT NULL REFERENCES auth.users(id),
  decision          text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  rejection_reason  text,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  escalation_level  integer NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  CONSTRAINT rejection_reason_required_when_rejected CHECK (
    decision = 'approved' OR (
      decision = 'rejected'
      AND rejection_reason IS NOT NULL
      AND char_length(rejection_reason) BETWEEN 30 AND 500
    )
  )
);

CREATE INDEX idx_social_post_approval_decisions_draft_id
  ON social_post_approval_decisions(draft_id);

ALTER TABLE social_post_approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_company ON social_post_approval_decisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = social_post_approval_decisions.draft_id
        AND is_company_member(d.company_id)
    )
  );

CREATE POLICY insert_as_approver ON social_post_approval_decisions
  FOR INSERT
  WITH CHECK (
    approver_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = draft_id
        AND is_company_member(d.company_id)
    )
  );

COMMIT;
