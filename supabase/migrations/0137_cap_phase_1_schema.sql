-- =============================================================================
-- 0137 — CAP Phase 1: Content Automation Platform schema
-- New tables: cap_subscriptions, cap_voice_profiles, cap_campaigns,
--             cap_campaign_posts, cap_generation_runs
-- New role: is_cap_operator on platform_users + helper function
-- New storage bucket: cap-campaign-images
-- Extends service_health_events event_type CHECK for cost_cap_exceeded +
--   missing_voice_profile
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. cap_operator role — same pattern as is_opollo_staff (0070)
-- ---------------------------------------------------------------------------

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS is_cap_operator BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_cap_operator
  ON platform_users(is_cap_operator)
  WHERE is_cap_operator = true;

CREATE OR REPLACE FUNCTION is_cap_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT is_cap_operator FROM platform_users WHERE id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON FUNCTION is_cap_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_cap_operator() TO authenticated, service_role;

-- Grant cap_operator to Steven (hi@opollo.com, id confirmed via Investigation 0)
UPDATE platform_users
  SET is_cap_operator = true
  WHERE id = '9987684b-6245-4aa7-93a0-2fbe3b7245db';

-- ---------------------------------------------------------------------------
-- 2. Extend service_health_events event_type to cover CAP-specific events
-- ---------------------------------------------------------------------------

ALTER TABLE service_health_events
  DROP CONSTRAINT IF EXISTS service_health_events_event_type_check;

ALTER TABLE service_health_events
  ADD CONSTRAINT service_health_events_event_type_check
    CHECK (event_type IN (
      'service_5xx',
      'connection_failure',
      'auth_failure',
      'billing_failure',
      'rate_limit',
      'webhook_auth_failure',
      'cron_stale',
      'recovered',
      'manual_flag',
      'cost_cap_exceeded',
      'missing_voice_profile'
    ));

-- ---------------------------------------------------------------------------
-- 3. cap_subscriptions — one per MSP customer company
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cap_subscriptions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL UNIQUE
                          REFERENCES platform_companies(id) ON DELETE CASCADE,
  tier                  text        NOT NULL
                          CHECK (tier IN ('starter', 'growth', 'agency')),
  status                text        NOT NULL
                          CHECK (status IN ('trial', 'active', 'paused', 'cancelled')),
  trial_ends_at         timestamptz,
  approval_required     boolean     NOT NULL DEFAULT false,
  monthly_cost_cap_usd  numeric(10, 2) NOT NULL DEFAULT 200.00,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cap_subscriptions_status
  ON cap_subscriptions(status);

CREATE TRIGGER trg_cap_subscriptions_updated
  BEFORE UPDATE ON cap_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cap_subscriptions ENABLE ROW LEVEL SECURITY;

-- service role bypasses RLS
CREATE POLICY service_role_all ON cap_subscriptions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Opollo staff: full access
CREATE POLICY staff_all ON cap_subscriptions
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

-- cap_operator: full read + write
CREATE POLICY cap_operator_all ON cap_subscriptions
  FOR ALL
  USING (is_cap_operator())
  WITH CHECK (is_cap_operator());

-- Company user: SELECT only their own subscription
CREATE POLICY company_user_select ON cap_subscriptions
  FOR SELECT
  USING (is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 4. cap_voice_profiles — N per subscription, 1 default enforced by partial index
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cap_voice_profiles (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_subscription_id   uuid        NOT NULL
                          REFERENCES cap_subscriptions(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  tone                  text        NOT NULL
                          CHECK (tone IN (
                            'professional-friendly',
                            'authoritative',
                            'conversational',
                            'technical',
                            'irreverent'
                          )),
  language_patterns     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  banned_words          text[]      NOT NULL DEFAULT '{}',
  on_brand_phrases      text[]      NOT NULL DEFAULT '{}',
  industry              text        NOT NULL,
  target_audience       text        NOT NULL,
  reference_posts       text[]      NOT NULL DEFAULT '{}',
  is_default            boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Enforce at most one default profile per subscription
CREATE UNIQUE INDEX IF NOT EXISTS cap_voice_profiles_one_default_per_sub
  ON cap_voice_profiles(cap_subscription_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_cap_voice_profiles_subscription
  ON cap_voice_profiles(cap_subscription_id);

CREATE TRIGGER trg_cap_voice_profiles_updated
  BEFORE UPDATE ON cap_voice_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cap_voice_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON cap_voice_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY staff_all ON cap_voice_profiles
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

CREATE POLICY cap_operator_all ON cap_voice_profiles
  FOR ALL
  USING (is_cap_operator())
  WITH CHECK (is_cap_operator());

CREATE POLICY company_user_select ON cap_voice_profiles
  FOR SELECT
  USING (
    cap_subscription_id IN (
      SELECT id FROM cap_subscriptions
      WHERE is_company_member(company_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 5. cap_campaigns — one per (subscription, month)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cap_campaigns (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_subscription_id   uuid        NOT NULL
                          REFERENCES cap_subscriptions(id) ON DELETE CASCADE,
  voice_profile_id      uuid        NOT NULL
                          REFERENCES cap_voice_profiles(id),
  month                 date        NOT NULL,
  monthly_objective     text        NOT NULL,
  status                text        NOT NULL
                          CHECK (status IN (
                            'draft', 'generating', 'review', 'approved',
                            'pushed', 'published', 'archived', 'failed'
                          )),
  created_by_user_id    uuid        REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cap_subscription_id, month)
);

CREATE INDEX IF NOT EXISTS idx_cap_campaigns_subscription
  ON cap_campaigns(cap_subscription_id, status);

CREATE INDEX IF NOT EXISTS idx_cap_campaigns_month
  ON cap_campaigns(month DESC);

CREATE TRIGGER trg_cap_campaigns_updated
  BEFORE UPDATE ON cap_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cap_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON cap_campaigns
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY staff_all ON cap_campaigns
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

CREATE POLICY cap_operator_all ON cap_campaigns
  FOR ALL
  USING (is_cap_operator())
  WITH CHECK (is_cap_operator());

CREATE POLICY company_user_select ON cap_campaigns
  FOR SELECT
  USING (
    cap_subscription_id IN (
      SELECT id FROM cap_subscriptions
      WHERE is_company_member(company_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6. cap_campaign_posts — 4 per campaign, one per arc phase / week
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cap_campaign_posts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_campaign_id       uuid        NOT NULL
                          REFERENCES cap_campaigns(id) ON DELETE CASCADE,
  week_number           integer     NOT NULL
                          CHECK (week_number BETWEEN 1 AND 4),
  arc_phase             text        NOT NULL
                          CHECK (arc_phase IN ('awareness', 'education', 'offer', 'proof')),
  generated_content     text,
  generated_image_url   text,
  generated_hashtags    text[]      NOT NULL DEFAULT '{}',
  social_draft_id       uuid        REFERENCES social_post_drafts(id),
  status                text        NOT NULL
                          CHECK (status IN (
                            'pending', 'generated', 'approved', 'rejected',
                            'pushed', 'published', 'failed', 'approved_past_due'
                          )),
  rejection_reason      text,
  regenerate_count      integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cap_campaign_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_cap_campaign_posts_campaign
  ON cap_campaign_posts(cap_campaign_id);

CREATE INDEX IF NOT EXISTS idx_cap_campaign_posts_draft
  ON cap_campaign_posts(social_draft_id)
  WHERE social_draft_id IS NOT NULL;

CREATE TRIGGER trg_cap_campaign_posts_updated
  BEFORE UPDATE ON cap_campaign_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE cap_campaign_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON cap_campaign_posts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY staff_all ON cap_campaign_posts
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

CREATE POLICY cap_operator_all ON cap_campaign_posts
  FOR ALL
  USING (is_cap_operator())
  WITH CHECK (is_cap_operator());

CREATE POLICY company_user_select ON cap_campaign_posts
  FOR SELECT
  USING (
    cap_campaign_id IN (
      SELECT c.id FROM cap_campaigns c
      JOIN cap_subscriptions s ON s.id = c.cap_subscription_id
      WHERE is_company_member(s.company_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 7. cap_generation_runs — audit trail for every Anthropic / Ideogram call
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cap_generation_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_campaign_post_id  uuid        REFERENCES cap_campaign_posts(id),
  cap_campaign_id       uuid        NOT NULL
                          REFERENCES cap_campaigns(id) ON DELETE CASCADE,
  operation             text        NOT NULL
                          CHECK (operation IN (
                            'text_generation', 'image_generation', 'full_campaign'
                          )),
  prompt_version        integer     NOT NULL,
  prompt_used           text        NOT NULL,
  model                 text        NOT NULL,
  input_tokens          integer,
  output_tokens         integer,
  estimated_cost_usd    numeric(10, 4) NOT NULL DEFAULT 0,
  latency_ms            integer,
  status                text        NOT NULL
                          CHECK (status IN ('success', 'error')),
  error_details         jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cap_generation_runs_campaign
  ON cap_generation_runs(cap_campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cap_generation_runs_created
  ON cap_generation_runs(created_at DESC);

ALTER TABLE cap_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON cap_generation_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY staff_all ON cap_generation_runs
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());

CREATE POLICY cap_operator_all ON cap_generation_runs
  FOR ALL
  USING (is_cap_operator())
  WITH CHECK (is_cap_operator());

CREATE POLICY company_user_select ON cap_generation_runs
  FOR SELECT
  USING (
    cap_campaign_id IN (
      SELECT c.id FROM cap_campaigns c
      JOIN cap_subscriptions s ON s.id = c.cap_subscription_id
      WHERE is_company_member(s.company_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Supabase Storage bucket: cap-campaign-images
--    public read, 10 MB file size limit
--    Service-role write via storage.objects policies (Supabase default for
--    named buckets: authenticated users cannot write unless explicitly granted)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cap-campaign-images',
  'cap-campaign-images',
  true,
  10485760,  -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Service role can upload to the bucket (CAP generation pipeline)
CREATE POLICY cap_images_service_insert ON storage.objects
  FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'cap-campaign-images');

CREATE POLICY cap_images_service_update ON storage.objects
  FOR UPDATE TO service_role
  USING (bucket_id = 'cap-campaign-images');

CREATE POLICY cap_images_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'cap-campaign-images');

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE cap_subscriptions IS 'CAP Phase 1: one row per MSP customer company. Tier + status + cost cap.';
COMMENT ON TABLE cap_voice_profiles IS 'CAP Phase 1: brand voice profile for AI generation. 1:N with cap_subscriptions; partial index enforces one default per subscription.';
COMMENT ON TABLE cap_campaigns IS 'CAP Phase 1: monthly campaign. One per (subscription, month). Holds 4 arc-phase posts.';
COMMENT ON TABLE cap_campaign_posts IS 'CAP Phase 1: one row per arc phase per campaign. Holds generated content + link to social_post_drafts after push.';
COMMENT ON TABLE cap_generation_runs IS 'CAP Phase 1: immutable audit trail for every Anthropic/Ideogram call. Used for cost tracking and prompt-engineering review.';
COMMENT ON COLUMN platform_users.is_cap_operator IS 'CAP Phase 1: Opollo staff member who manages CAP subscriptions. Same pattern as is_opollo_staff.';

-- ---------------------------------------------------------------------------
-- Seed cron_heartbeats for new CAP cron jobs
-- ---------------------------------------------------------------------------
INSERT INTO cron_heartbeats (job_name, last_run_at, last_status) VALUES
  ('cap-monthly-generation',        NOW(), 'ok'),
  ('cap-generation-runs-cleanup',   NOW(), 'ok')
ON CONFLICT (job_name) DO NOTHING;

COMMIT;
