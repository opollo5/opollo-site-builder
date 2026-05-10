-- BSP analytics foundation — bundle.social-sourced engagement metrics.
--
-- Three tables:
--   1. social_profile_analytics_snapshots — daily per-account
--      aggregate metrics (followers, impressions, views).
--   2. social_post_analytics_snapshots — daily per-post metrics
--      (impressions, likes, comments, shares, etc.) PLUS the post's
--      content captured at first import. bundle.social only retains
--      raw post content for ~30 days; capturing it on first insert
--      means we can render top posts beyond that retention.
--   3. social_post_history_imports — operational record of every
--      post-history import job triggered on a fresh connect.
--
-- All three are profile-scoped (FK → platform_social_profiles).
-- RLS: company members read; opollo_staff writes.
--
-- Capacity: a customer with 5 platforms × 50 posts × 365 days = ~91k
-- post-snapshot rows per profile per year. Comfortable for Postgres.

-- ---------------------------------------------------------------------------
-- 1. social_profile_analytics_snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE social_profile_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES platform_social_profiles(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  bundle_social_account_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  -- 'rolling' = N-day window (most platforms),
  -- 'lifetime' = since-account-creation aggregate,
  -- 'snapshot' = point-in-time (followers count etc.).
  period_kind TEXT NOT NULL DEFAULT 'snapshot'
    CHECK (period_kind IN ('rolling', 'lifetime', 'snapshot')),
  followers BIGINT,
  following BIGINT,
  post_count BIGINT,
  impressions BIGINT,
  impressions_unique BIGINT,
  views BIGINT,
  views_unique BIGINT,
  likes BIGINT,
  comments BIGINT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, platform, bundle_social_account_id, snapshot_date)
);

CREATE INDEX idx_social_profile_analytics_profile_date
  ON social_profile_analytics_snapshots(profile_id, snapshot_date);

CREATE INDEX idx_social_profile_analytics_profile_platform_date
  ON social_profile_analytics_snapshots(profile_id, platform, snapshot_date);

CREATE TRIGGER social_profile_analytics_snapshots_set_updated_at
  BEFORE UPDATE ON social_profile_analytics_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_profile_analytics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_profile_analytics_read ON social_profile_analytics_snapshots
  FOR SELECT
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM platform_social_profiles p
      WHERE p.id = social_profile_analytics_snapshots.profile_id
        AND is_company_member(p.company_id)
    )
  );

CREATE POLICY social_profile_analytics_staff_write ON social_profile_analytics_snapshots
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

COMMENT ON TABLE social_profile_analytics_snapshots IS
  'BSP analytics: daily per-account aggregate metrics (followers, '
  'impressions, post count). One row per (profile, platform, account, day). '
  'Populated by /api/cron/social-analytics-refresh at 04:00 UTC.';

-- ---------------------------------------------------------------------------
-- 2. social_post_analytics_snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE social_post_analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES platform_social_profiles(id) ON DELETE CASCADE,
  bundle_post_id TEXT NOT NULL,
  platform social_platform NOT NULL,
  bundle_social_account_id TEXT,
  snapshot_date DATE NOT NULL,
  posted_at TIMESTAMPTZ,
  -- Deep link to the post on its native platform (set on first import).
  post_url TEXT,
  -- Content captured at FIRST snapshot so we can render top posts even
  -- after bundle.social's 30-day raw-content retention purges them.
  -- Never updated by subsequent metric refreshes.
  title TEXT,
  content TEXT,
  media_urls TEXT[],
  impressions BIGINT,
  impressions_unique BIGINT,
  views BIGINT,
  views_unique BIGINT,
  likes BIGINT,
  dislikes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  engagement_rate NUMERIC GENERATED ALWAYS AS (
    (COALESCE(likes, 0) + COALESCE(comments, 0) + COALESCE(shares, 0))::numeric
    / NULLIF(impressions, 0)
  ) STORED,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, bundle_post_id, snapshot_date)
);

CREATE INDEX idx_social_post_analytics_profile_posted_at
  ON social_post_analytics_snapshots(profile_id, posted_at DESC NULLS LAST);

CREATE INDEX idx_social_post_analytics_profile_platform_engagement
  ON social_post_analytics_snapshots(profile_id, platform, engagement_rate DESC NULLS LAST);

CREATE INDEX idx_social_post_analytics_profile_snapshot_date
  ON social_post_analytics_snapshots(profile_id, snapshot_date);

CREATE TRIGGER social_post_analytics_snapshots_set_updated_at
  BEFORE UPDATE ON social_post_analytics_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_post_analytics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_post_analytics_read ON social_post_analytics_snapshots
  FOR SELECT
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM platform_social_profiles p
      WHERE p.id = social_post_analytics_snapshots.profile_id
        AND is_company_member(p.company_id)
    )
  );

CREATE POLICY social_post_analytics_staff_write ON social_post_analytics_snapshots
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

COMMENT ON TABLE social_post_analytics_snapshots IS
  'BSP analytics: daily per-post engagement metrics + first-import '
  'snapshot of post content (title, body, media URLs, permalink). '
  'Captured this way because bundle.social purges raw content after '
  '~30 days. engagement_rate is a STORED generated column.';

-- ---------------------------------------------------------------------------
-- 3. social_post_history_imports
-- ---------------------------------------------------------------------------

CREATE TABLE social_post_history_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES platform_social_profiles(id) ON DELETE CASCADE,
  bundle_social_account_id TEXT NOT NULL,
  platform social_platform NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timeout')),
  -- bundle.social's import-job id (postImportCreate response). Populated
  -- once the QStash job has started the upstream import.
  bundle_import_id TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  posts_imported INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_post_history_imports_profile_status
  ON social_post_history_imports(profile_id, status);

CREATE INDEX idx_social_post_history_imports_profile_created_at
  ON social_post_history_imports(profile_id, created_at DESC);

-- Idempotency: a connect-callback + a webhook arriving in the same
-- second must not produce two imports. The connect path inserts with
-- ON CONFLICT (profile_id, bundle_social_account_id) WHERE status IN
-- (queued, running, succeeded) DO NOTHING — and Postgres requires a
-- matching partial unique index.
CREATE UNIQUE INDEX idx_social_post_history_imports_active_dedup
  ON social_post_history_imports(profile_id, bundle_social_account_id)
  WHERE status IN ('queued', 'running', 'succeeded');

CREATE TRIGGER social_post_history_imports_set_updated_at
  BEFORE UPDATE ON social_post_history_imports
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_post_history_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_post_history_imports_read ON social_post_history_imports
  FOR SELECT
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM platform_social_profiles p
      WHERE p.id = social_post_history_imports.profile_id
        AND is_company_member(p.company_id)
    )
  );

CREATE POLICY social_post_history_imports_staff_write ON social_post_history_imports
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

COMMENT ON TABLE social_post_history_imports IS
  'BSP analytics: operational record of post-history imports triggered '
  'on a fresh social-account connect. One row per (profile, account) — '
  'active-dedup partial unique index prevents duplicate queues from '
  'racing connect-callback + webhook arrivals.';
