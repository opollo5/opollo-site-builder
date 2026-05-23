-- Migration: Insights module foundation
-- Creates 9 ins_* tables, enables RLS, extends cap_generation_runs.operation

-- ---------------------------------------------------------------------------
-- Table 1: ins_post_features
-- ---------------------------------------------------------------------------
CREATE TABLE ins_post_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  profile_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('composer', 'cap')),
  bundle_post_id TEXT NOT NULL,
  cap_campaign_post_id UUID,
  platform social_platform NOT NULL,

  word_count INTEGER NOT NULL,
  sentence_count INTEGER NOT NULL,
  has_question BOOLEAN NOT NULL,
  emoji_count INTEGER NOT NULL DEFAULT 0,
  hashtag_count INTEGER NOT NULL DEFAULT 0,
  has_link BOOLEAN NOT NULL,
  has_media BOOLEAN NOT NULL,
  media_type TEXT,
  reading_grade NUMERIC(4,2),

  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_of_day_utc INTEGER NOT NULL CHECK (hour_of_day_utc BETWEEN 0 AND 23),
  hour_of_day_client_tz INTEGER NOT NULL CHECK (hour_of_day_client_tz BETWEEN 0 AND 23),

  sentiment_score NUMERIC(3,2),
  topic_tags TEXT[],

  posted_at TIMESTAMPTZ NOT NULL,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,

  UNIQUE (bundle_post_id)
);

CREATE INDEX idx_ins_post_features_company_platform_posted
  ON ins_post_features (company_id, platform, posted_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_ins_post_features_company_posted
  ON ins_post_features (company_id, posted_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_ins_post_features_updated_at
  BEFORE UPDATE ON ins_post_features
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 2: ins_client_memory
-- ---------------------------------------------------------------------------
CREATE TABLE ins_client_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('dismissal', 'edit_pattern', 'winning_pattern', 'industry_signal')),
  payload JSONB NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0,
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

CREATE INDEX idx_ins_client_memory_company_type
  ON ins_client_memory (company_id, memory_type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_ins_client_memory_updated_at
  BEFORE UPDATE ON ins_client_memory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 3: ins_recommendations
-- ---------------------------------------------------------------------------
CREATE TABLE ins_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  platform social_platform NOT NULL,
  recommendation_type TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  confidence_score NUMERIC(4,3) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('strong', 'moderate', 'below_floor')),
  evidence_refs UUID[] NOT NULL DEFAULT '{}',
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_recommendations_company_platform_active
  ON ins_recommendations (company_id, platform, generated_at DESC)
  WHERE suppressed = FALSE;

CREATE INDEX idx_ins_recommendations_expires
  ON ins_recommendations (expires_at);

CREATE TRIGGER trg_ins_recommendations_updated_at
  BEFORE UPDATE ON ins_recommendations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 4: ins_recommendation_evidence
-- ---------------------------------------------------------------------------
CREATE TABLE ins_recommendation_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES ins_recommendations(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL CHECK (source_table IN ('social_post_analytics_snapshots', 'ins_post_features')),
  source_row_ref TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_recommendation_evidence_rec
  ON ins_recommendation_evidence (recommendation_id);

-- ---------------------------------------------------------------------------
-- Table 5: ins_consent
-- ---------------------------------------------------------------------------
CREATE TABLE ins_consent (
  company_id UUID PRIMARY KEY,
  cross_client_learning_consent BOOLEAN NOT NULL DEFAULT FALSE,
  competitor_tracking_consent BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at TIMESTAMPTZ,
  consented_by_user_id UUID,
  msa_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_ins_consent_updated_at
  BEFORE UPDATE ON ins_consent
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 6: ins_ingest_log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE ins_ingest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_route TEXT NOT NULL,
  company_id UUID,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posts_processed INTEGER NOT NULL DEFAULT 0,
  metrics_recorded INTEGER NOT NULL DEFAULT 0,
  features_extracted INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL
);

CREATE INDEX idx_ins_ingest_log_cron_ran
  ON ins_ingest_log (cron_route, ran_at DESC);

CREATE INDEX idx_ins_ingest_log_company_ran
  ON ins_ingest_log (company_id, ran_at DESC)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Table 7: ins_admin_audit (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE ins_admin_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id UUID NOT NULL,
  client_company_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'dismiss', 'annotate', 'export', 'override', 'unsuppress')),
  action_details JSONB NOT NULL DEFAULT '{}',
  client_ip TEXT,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_admin_audit_operator_occurred
  ON ins_admin_audit (operator_user_id, occurred_at DESC);

CREATE INDEX idx_ins_admin_audit_client_occurred
  ON ins_admin_audit (client_company_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Table 8: ins_competitor_accounts (Phase 3 placeholder)
-- ---------------------------------------------------------------------------
CREATE TABLE ins_competitor_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  platform social_platform NOT NULL,
  competitor_handle TEXT NOT NULL,
  competitor_display_name TEXT,
  added_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE (company_id, platform, competitor_handle)
);

CREATE INDEX idx_ins_competitor_accounts_company
  ON ins_competitor_accounts (company_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_ins_competitor_accounts_updated_at
  BEFORE UPDATE ON ins_competitor_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 9: ins_competitor_posts (Phase 3 placeholder)
-- ---------------------------------------------------------------------------
CREATE TABLE ins_competitor_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analyzing_for_company_ids UUID[] NOT NULL,
  competitor_account_id UUID NOT NULL REFERENCES ins_competitor_accounts(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  external_post_id TEXT NOT NULL,
  content TEXT,
  impressions BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  engagement_rate NUMERIC,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (competitor_account_id, external_post_id)
);

CREATE INDEX idx_ins_competitor_posts_account_posted
  ON ins_competitor_posts (competitor_account_id, posted_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

ALTER TABLE ins_post_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_post_features_read ON ins_post_features FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_post_features_staff_write ON ins_post_features FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_client_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_client_memory_read ON ins_client_memory FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_client_memory_staff_write ON ins_client_memory FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_recommendations_read ON ins_recommendations FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_recommendations_staff_write ON ins_recommendations FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_recommendation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_recommendation_evidence_read ON ins_recommendation_evidence FOR SELECT
  USING (
    is_opollo_staff() OR
    EXISTS (
      SELECT 1 FROM ins_recommendations
      WHERE id = ins_recommendation_evidence.recommendation_id
        AND is_company_member(company_id)
    )
  );
CREATE POLICY ins_recommendation_evidence_staff_write ON ins_recommendation_evidence FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_consent_read ON ins_consent FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_consent_company_write ON ins_consent FOR UPDATE
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_consent_staff_insert ON ins_consent FOR INSERT
  WITH CHECK (is_opollo_staff());

ALTER TABLE ins_ingest_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_ingest_log_staff_read ON ins_ingest_log FOR SELECT
  USING (is_opollo_staff());
CREATE POLICY ins_ingest_log_staff_write ON ins_ingest_log FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_admin_audit_staff_read ON ins_admin_audit FOR SELECT
  USING (is_opollo_staff());
CREATE POLICY ins_admin_audit_staff_insert ON ins_admin_audit FOR INSERT
  WITH CHECK (is_opollo_staff());

ALTER TABLE ins_competitor_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_competitor_accounts_read ON ins_competitor_accounts FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY ins_competitor_accounts_staff_write ON ins_competitor_accounts FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

ALTER TABLE ins_competitor_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_competitor_posts_read ON ins_competitor_posts FOR SELECT
  USING (
    is_opollo_staff() OR
    EXISTS (
      SELECT 1 FROM unnest(analyzing_for_company_ids) AS cid
      WHERE is_company_member(cid)
    )
  );
CREATE POLICY ins_competitor_posts_staff_write ON ins_competitor_posts FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

-- ---------------------------------------------------------------------------
-- Extend cap_generation_runs.operation CHECK constraint
-- ---------------------------------------------------------------------------
ALTER TABLE cap_generation_runs DROP CONSTRAINT cap_generation_runs_operation_check;
ALTER TABLE cap_generation_runs ADD CONSTRAINT cap_generation_runs_operation_check
  CHECK (operation IN (
    'text_generation',
    'image_generation',
    'full_campaign',
    'insights_feature_extract',
    'insights_recompute'
  ));
