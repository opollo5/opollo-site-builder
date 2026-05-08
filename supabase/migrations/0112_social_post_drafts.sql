-- Spec 22 PR 1 — universal social composer draft persistence layer.
--
-- Design decisions:
--   1. draft_version INT enables optimistic concurrency per ADR-0002: the
--      save endpoint does a CAS UPDATE (WHERE id=$id AND draft_version=$v)
--      and returns 409 VERSION_CONFLICT when 0 rows affected so the UI can
--      show "Reload latest?" rather than silently losing a concurrent save.
--   2. draft_data JSONB stores the full Draft payload (master_text, media_refs,
--      target_connection_ids, schedule, approval_required, ai_metadata).
--      Keeping it as JSONB defers schema evolution to app logic; individual
--      fields don't need columns until query/index pressure demands it.
--   3. archived_at enables soft-delete. Hard deletes occur on publish (draft
--      row removed) and on company cascade-delete (ON DELETE CASCADE).
--   4. RLS gates on platform_company_users so only editors/approvers/admins
--      of the owning company can read or write their own drafts.
--   5. service_role bypasses RLS for the create/save API routes.

CREATE TABLE social_post_drafts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  created_by        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_by        UUID        NOT NULL REFERENCES auth.users(id),
  draft_version     INT         NOT NULL DEFAULT 1,
  draft_data        JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMPTZ NULL
);

-- Fast lookup of active drafts for a company (list + conflict-check on open).
CREATE INDEX idx_social_post_drafts_company
  ON social_post_drafts (company_id, archived_at)
  WHERE archived_at IS NULL;

-- Feed for "my drafts" view scoped by author.
CREATE INDEX idx_social_post_drafts_created_by
  ON social_post_drafts (created_by, updated_at DESC)
  WHERE archived_at IS NULL;

-- General-purpose recency ordering used by admin list + draft-recovery.
CREATE INDEX idx_social_post_drafts_updated
  ON social_post_drafts (updated_at DESC);

-- RLS: allow all platform company editors/approvers/admins to read and
-- write their own company's drafts. Service-role callers bypass this.
ALTER TABLE social_post_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_post_drafts_company_editors
  ON social_post_drafts FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM platform_company_users
      WHERE user_id = auth.uid()
        AND role IN ('editor', 'approver', 'admin', 'super_admin')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM platform_company_users
      WHERE user_id = auth.uid()
        AND role IN ('editor', 'approver', 'admin', 'super_admin')
    )
  );
