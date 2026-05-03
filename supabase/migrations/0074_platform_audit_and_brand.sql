-- =============================================================================
-- 0074 — Platform/Social audit columns + brand governance + image-gen log
-- =============================================================================
-- Layered on top of 0070_platform_foundation.sql + the 0071–0073 approval
-- RPCs. Adds the data conventions the original P1 spec called for but that
-- 0070 shipped without:
--
--   1. version_lock + soft-delete + audit columns on long-lived platform/
--      social tables; _active views over them.
--   2. Auth helpers (is_opollo_staff / is_company_member / has_company_role /
--      current_user_company) updated to filter deleted_at IS NULL — RLS
--      policies that call these inherit the new behaviour for free.
--   3. Enum extensions: 'degraded' on social_attempt_status,
--      'image_generation_failed' on platform_notification_type. Note: a
--      newly-added enum value cannot be referenced in the same transaction
--      it was added in — the partial index that wants 'degraded' uses a
--      NOT IN clause over terminal states (already-existing values) so the
--      index implicitly covers 'degraded' rows without naming them.
--   4. platform_email_log + platform_email_status enum (transactional email
--      audit trail; lib/email/sendgrid.ts writes one row per dispatch).
--   5. brand_profile_id / brand_profile_version stamped on
--      social_post_master at submission time (FK wired after the brand
--      table is created).
--   6. company_id denormalised onto social_publish_attempts so the
--      concurrent-publish cap check is one indexed COUNT(*).
--   7. Brand governance: platform_brand_profiles (versioned via
--      update_brand_profile() RPC — never UPDATE directly),
--      platform_product_subscriptions, image_generation_log,
--      get_active_brand_profile() / can_access_product() helpers, RLS,
--      seed for the Opollo internal company.
--
-- Write-safety hotspots addressed:
--   - update_brand_profile() RPC is the only mutation path for brand
--     profiles; it flips is_active=false on the current row and inserts a
--     new versioned row in one statement-level transaction so no concurrent
--     reader ever sees zero or two active rows.
--   - UNIQUE (company_id) WHERE is_active=true on platform_brand_profiles
--     enforces the "exactly one active version" invariant at the schema
--     layer (defense in depth for the RPC).
--   - UNIQUE (company_id, product) on platform_product_subscriptions
--     prevents duplicate active subscriptions per product.
--   - company_id on social_publish_attempts is backfilled from the
--     existing publish_jobs JOIN before the NOT NULL constraint flips, so
--     re-applying against a populated dev DB doesn't break.
-- =============================================================================

-- =============================================================================
-- ENUM ADDITIONS
-- =============================================================================
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is PG13+. Supabase ships PG15.
-- The new value 'degraded' is added here but cannot be referenced
-- (partial-index WHERE, INSERT/UPDATE) in this same transaction — that's
-- why the social_publish_attempts partial index uses NOT IN of the
-- terminal states instead of IN of the in-flight states.

ALTER TYPE social_attempt_status ADD VALUE IF NOT EXISTS 'degraded';
ALTER TYPE platform_notification_type ADD VALUE IF NOT EXISTS 'image_generation_failed';

-- New enums introduced by this migration
CREATE TYPE platform_email_status AS ENUM (
  'queued',
  'sent',
  'failed_retryable',
  'failed_terminal'
);

CREATE TYPE brand_formality   AS ENUM ('formal', 'semi_formal', 'casual');
CREATE TYPE brand_pov         AS ENUM ('first_person', 'third_person');
CREATE TYPE brand_hashtag     AS ENUM ('none', 'minimal', 'standard', 'heavy');
CREATE TYPE brand_post_length AS ENUM ('short', 'medium', 'long');
CREATE TYPE opollo_product    AS ENUM ('site_builder', 'social', 'cap', 'blog', 'email');
CREATE TYPE image_gen_outcome AS ENUM (
  'success',
  'retry_success',
  'stock_fallback',
  'escalated',
  'failed'
);

-- =============================================================================
-- AUDIT COLUMNS — platform layer
-- =============================================================================

ALTER TABLE platform_companies
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE platform_users
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE platform_company_users
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER trg_company_users_updated BEFORE UPDATE ON platform_company_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE platform_invitations
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN revoked_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;
CREATE TRIGGER trg_invitations_updated BEFORE UPDATE ON platform_invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- AUDIT COLUMNS — social layer (long-lived tables only; append-only
-- audit/log tables are intentionally excluded)
-- =============================================================================

ALTER TABLE social_connections
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE social_post_master
  ADD COLUMN version_lock          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at             TIMESTAMPTZ,
  ADD COLUMN deleted_by             UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by             UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN brand_profile_id       UUID,  -- FK wired below, after platform_brand_profiles exists
  ADD COLUMN brand_profile_version  INTEGER;
COMMENT ON COLUMN social_post_master.version_lock IS
  'Optimistic concurrency. Mutate with WHERE id=$1 AND version_lock=$2. Zero rows = 409 VERSION_CONFLICT.';
COMMENT ON COLUMN social_post_master.brand_profile_id IS
  'Stamped at submission from active brand profile. Never updated. FK to platform_brand_profiles wired in same migration.';

ALTER TABLE social_post_variant
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE social_media_assets
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN deleted_at   TIMESTAMPTZ,
  ADD COLUMN deleted_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

ALTER TABLE social_approval_requests
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER trg_approval_requests_updated BEFORE UPDATE ON social_approval_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_viewer_links
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER trg_viewer_links_updated BEFORE UPDATE ON social_viewer_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_schedule_entries
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER trg_schedule_entries_updated BEFORE UPDATE ON social_schedule_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_publish_jobs
  ADD COLUMN version_lock INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN created_by   UUID REFERENCES platform_users(id) ON DELETE SET NULL;

-- =============================================================================
-- DENORMALISE company_id ONTO social_publish_attempts
-- =============================================================================
-- The L4 cap check (`SELECT COUNT(*) WHERE company_id=$1 AND status IN
-- (in-flight states)`) needs the company_id locally indexed. Backfill from
-- publish_jobs JOIN, then flip NOT NULL.

ALTER TABLE social_publish_attempts
  ADD COLUMN company_id UUID REFERENCES platform_companies(id) ON DELETE CASCADE;

UPDATE social_publish_attempts a
   SET company_id = j.company_id
  FROM social_publish_jobs j
 WHERE a.publish_job_id = j.id
   AND a.company_id IS NULL;

ALTER TABLE social_publish_attempts
  ALTER COLUMN company_id SET NOT NULL;

COMMENT ON COLUMN social_publish_attempts.company_id IS
  'Denormalised for cap check: SELECT COUNT(*) WHERE company_id=$1 AND status NOT IN (terminal states). Cap at platform_companies.concurrent_publish_limit.';

-- Partial index covering the in-flight statuses. Uses NOT IN of the
-- terminal statuses (existing values) so it implicitly covers 'degraded'
-- (added by this migration; cannot be named in same transaction). New
-- statuses added later flow into this index automatically until they
-- become terminal.
CREATE INDEX idx_attempts_company_status
  ON social_publish_attempts(company_id, status)
  WHERE status NOT IN ('succeeded', 'failed', 'reconciling');

-- =============================================================================
-- _active VIEWS
-- =============================================================================
-- View consumers should prefer these over base tables. RLS still applies
-- to the underlying table when querying through the view.

CREATE VIEW platform_companies_active     AS SELECT * FROM platform_companies     WHERE deleted_at IS NULL;
CREATE VIEW platform_users_active         AS SELECT * FROM platform_users         WHERE deleted_at IS NULL;
CREATE VIEW platform_company_users_active AS SELECT * FROM platform_company_users WHERE deleted_at IS NULL;
CREATE VIEW social_connections_active     AS SELECT * FROM social_connections     WHERE deleted_at IS NULL;
CREATE VIEW social_post_master_active     AS SELECT * FROM social_post_master     WHERE deleted_at IS NULL;
CREATE VIEW social_post_variant_active    AS SELECT * FROM social_post_variant    WHERE deleted_at IS NULL;

-- =============================================================================
-- AUTH HELPERS — filter soft-deleted rows
-- =============================================================================
-- CREATE OR REPLACE preserves the function signature so existing RLS
-- policies that call these continue to work; their behaviour now excludes
-- soft-deleted users / memberships transparently.

CREATE OR REPLACE FUNCTION is_opollo_staff()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_opollo_staff FROM platform_users
      WHERE id = auth.uid() AND deleted_at IS NULL),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_company_member(company UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_company_users
     WHERE company_id = company
       AND user_id    = auth.uid()
       AND deleted_at IS NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_company_role(company UUID, min_role platform_company_role)
RETURNS BOOLEAN AS $$
DECLARE
  user_role platform_company_role;
  role_rank INT;
  min_rank  INT;
BEGIN
  SELECT role INTO user_role
    FROM platform_company_users
   WHERE company_id = company
     AND user_id    = auth.uid()
     AND deleted_at IS NULL;

  IF user_role IS NULL THEN
    RETURN false;
  END IF;

  role_rank := CASE user_role
    WHEN 'admin'    THEN 4
    WHEN 'approver' THEN 3
    WHEN 'editor'   THEN 2
    WHEN 'viewer'   THEN 1
  END;
  min_rank := CASE min_role
    WHEN 'admin'    THEN 4
    WHEN 'approver' THEN 3
    WHEN 'editor'   THEN 2
    WHEN 'viewer'   THEN 1
  END;
  RETURN role_rank >= min_rank;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_company()
RETURNS UUID AS $$
  SELECT company_id FROM platform_company_users
   WHERE user_id = auth.uid() AND deleted_at IS NULL
   LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- platform_email_log
-- =============================================================================

CREATE TABLE platform_email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email     TEXT NOT NULL,
  subject             TEXT NOT NULL,
  notification_type   platform_notification_type,
  is_critical         BOOLEAN NOT NULL DEFAULT false,
  status              platform_email_status NOT NULL DEFAULT 'queued',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  sendgrid_message_id TEXT,
  related_company_id  UUID REFERENCES platform_companies(id) ON DELETE SET NULL,
  related_user_id     UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at     TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ
);
CREATE INDEX idx_email_log_failed
  ON platform_email_log(status)
  WHERE status IN ('failed_retryable', 'failed_terminal');
CREATE INDEX idx_email_log_company
  ON platform_email_log(related_company_id)
  WHERE related_company_id IS NOT NULL;

COMMENT ON TABLE platform_email_log IS
  'Audit row per transactional email dispatch. Subject + recipient + result only — never bodies. '
  'Written by lib/email/sendgrid.ts (the single allowed @sendgrid/mail import path).';

ALTER TABLE platform_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_log_staff_only ON platform_email_log FOR ALL
  USING (is_opollo_staff());

-- =============================================================================
-- BRAND GOVERNANCE — platform_brand_profiles
-- =============================================================================

CREATE TABLE platform_brand_profiles (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  version                    INTEGER NOT NULL DEFAULT 1,
  is_active                  BOOLEAN NOT NULL DEFAULT true,
  change_summary             TEXT,

  -- Visual identity
  primary_colour             TEXT,
  secondary_colour           TEXT,
  accent_colour              TEXT,
  logo_primary_url           TEXT,
  logo_dark_url              TEXT,
  logo_light_url             TEXT,
  logo_icon_url              TEXT,
  heading_font               TEXT,
  body_font                  TEXT,
  image_style                JSONB DEFAULT '{}'::jsonb,
  approved_style_ids         TEXT[] DEFAULT '{}',
  safe_mode                  BOOLEAN NOT NULL DEFAULT false,

  -- Tone of voice
  personality_traits         TEXT[] DEFAULT '{}',
  formality                  brand_formality DEFAULT 'semi_formal',
  point_of_view              brand_pov DEFAULT 'third_person',
  preferred_vocabulary       TEXT[] DEFAULT '{}',
  avoided_terms              TEXT[] DEFAULT '{}',
  voice_examples             TEXT[] DEFAULT '{}',

  -- Content guardrails
  focus_topics               TEXT[] DEFAULT '{}',
  avoided_topics             TEXT[] DEFAULT '{}',
  industry                   TEXT,

  -- Operational defaults
  default_approval_required  BOOLEAN NOT NULL DEFAULT true,
  default_approval_rule      social_approval_rule DEFAULT 'any_one',
  platform_overrides       JSONB DEFAULT '{}'::jsonb,
  hashtag_strategy           brand_hashtag DEFAULT 'minimal',
  max_post_length            brand_post_length DEFAULT 'medium',
  content_restrictions       TEXT[] DEFAULT '{}',

  -- Audit
  updated_by                 UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_by                 UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one active version per company
CREATE UNIQUE INDEX idx_brand_profiles_active  ON platform_brand_profiles(company_id) WHERE is_active = true;
CREATE INDEX        idx_brand_profiles_history ON platform_brand_profiles(company_id, version DESC);

CREATE TRIGGER trg_brand_profiles_updated BEFORE UPDATE ON platform_brand_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE platform_brand_profiles IS
  'Versioned brand profile. NEVER UPDATE directly. Always call update_brand_profile() RPC. '
  'safe_mode=true: blocks bold_promo + editorial styles, stock-first image routing. '
  'content_restrictions: requires Opollo staff approval to modify — enforced at app layer.';

-- Now wire the FK on social_post_master.brand_profile_id (table exists, column exists)
ALTER TABLE social_post_master
  ADD CONSTRAINT fk_post_master_brand_profile
    FOREIGN KEY (brand_profile_id) REFERENCES platform_brand_profiles(id) ON DELETE SET NULL;

-- =============================================================================
-- BRAND GOVERNANCE — platform_product_subscriptions
-- =============================================================================

CREATE TABLE platform_product_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  product        opollo_product NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  activated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  notes          TEXT,
  version_lock   INTEGER NOT NULL DEFAULT 1,
  created_by     UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  updated_by     UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, product)
);
CREATE INDEX idx_product_subs_active ON platform_product_subscriptions(company_id) WHERE is_active = true;

CREATE TRIGGER trg_product_subs_updated BEFORE UPDATE ON platform_product_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- BRAND GOVERNANCE — image_generation_log (append-only audit)
-- =============================================================================

CREATE TABLE image_generation_log (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  brand_profile_id        UUID REFERENCES platform_brand_profiles(id) ON DELETE SET NULL,
  brand_profile_version   INTEGER,

  -- Prompt inputs
  style_id                TEXT NOT NULL,
  composition_type        TEXT NOT NULL,
  aspect_ratio            TEXT NOT NULL,
  model_used              TEXT NOT NULL,
  model_tier              TEXT NOT NULL,
  prompt_used             TEXT NOT NULL,

  -- Outcome
  outcome                 image_gen_outcome NOT NULL,
  retry_count             INTEGER NOT NULL DEFAULT 0,
  fallback_used           BOOLEAN NOT NULL DEFAULT false,
  compositing_provider    TEXT,
  template_id             TEXT,

  -- Quality
  quality_check_passed    BOOLEAN,
  luminance_score         NUMERIC,
  safe_zone_score         NUMERIC,

  -- Storage references
  background_storage_path TEXT,
  output_storage_path     TEXT,

  -- Linkage
  post_master_id          UUID REFERENCES social_post_master(id) ON DELETE SET NULL,

  -- Failure detail
  error_class             TEXT,
  error_detail            TEXT,

  -- Timing
  generation_duration_ms  INTEGER,
  compositing_duration_ms INTEGER,

  triggered_by            UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_image_log_company  ON image_generation_log(company_id, created_at DESC);
CREATE INDEX idx_image_log_outcome  ON image_generation_log(outcome) WHERE outcome != 'success';
CREATE INDEX idx_image_log_post     ON image_generation_log(post_master_id) WHERE post_master_id IS NOT NULL;

COMMENT ON TABLE image_generation_log IS
  'Append-only audit log for every image generation attempt. '
  'Records: prompt, model, outcome, fallback, quality scores, storage paths. '
  'Written by lib/image/failure/handler.ts ONLY. Never skip this write.';

-- =============================================================================
-- BRAND HELPER FUNCTIONS
-- =============================================================================

CREATE OR REPLACE FUNCTION get_active_brand_profile(p_company_id UUID)
RETURNS platform_brand_profiles AS $$
  SELECT * FROM platform_brand_profiles
   WHERE company_id = p_company_id AND is_active = true
   LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION can_access_product(p_company_id UUID, p_product opollo_product)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_product_subscriptions
     WHERE company_id = p_company_id
       AND product    = p_product
       AND is_active  = true
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- The brand-profile mutation contract. App MUST call this RPC; never UPDATE
-- platform_brand_profiles directly. Flips the current row's is_active=false
-- and inserts a new row with version+1 and is_active=true. Single SECURITY
-- DEFINER call so concurrent readers always see exactly one active row.
CREATE OR REPLACE FUNCTION update_brand_profile(
  p_company_id     UUID,
  p_updated_by     UUID,
  p_change_summary TEXT,
  p_fields         JSONB
) RETURNS platform_brand_profiles AS $$
DECLARE
  cur platform_brand_profiles;
  nxt platform_brand_profiles;
BEGIN
  SELECT * INTO cur
    FROM platform_brand_profiles
   WHERE company_id = p_company_id AND is_active = true
   LIMIT 1;

  IF cur IS NULL THEN
    RAISE EXCEPTION 'No active brand profile for company %', p_company_id;
  END IF;

  UPDATE platform_brand_profiles
     SET is_active   = false,
         updated_at  = now(),
         updated_by  = p_updated_by
   WHERE id = cur.id;

  INSERT INTO platform_brand_profiles (
    company_id, version, is_active, change_summary, updated_by, created_by,
    primary_colour, secondary_colour, accent_colour,
    logo_primary_url, logo_dark_url, logo_light_url, logo_icon_url,
    heading_font, body_font, image_style, approved_style_ids, safe_mode,
    personality_traits, formality, point_of_view,
    preferred_vocabulary, avoided_terms, voice_examples,
    focus_topics, avoided_topics, industry,
    default_approval_required, default_approval_rule, platform_overrides,
    hashtag_strategy, max_post_length, content_restrictions
  ) VALUES (
    p_company_id, cur.version + 1, true, p_change_summary, p_updated_by, cur.created_by,
    COALESCE((p_fields->>'primary_colour'),    cur.primary_colour),
    COALESCE((p_fields->>'secondary_colour'),  cur.secondary_colour),
    COALESCE((p_fields->>'accent_colour'),     cur.accent_colour),
    COALESCE((p_fields->>'logo_primary_url'),  cur.logo_primary_url),
    COALESCE((p_fields->>'logo_dark_url'),     cur.logo_dark_url),
    COALESCE((p_fields->>'logo_light_url'),    cur.logo_light_url),
    COALESCE((p_fields->>'logo_icon_url'),     cur.logo_icon_url),
    COALESCE((p_fields->>'heading_font'),      cur.heading_font),
    COALESCE((p_fields->>'body_font'),         cur.body_font),
    COALESCE((p_fields->'image_style'),        cur.image_style),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'approved_style_ids')),
      cur.approved_style_ids
    ),
    COALESCE((p_fields->>'safe_mode')::boolean, cur.safe_mode),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'personality_traits')),
      cur.personality_traits
    ),
    COALESCE((p_fields->>'formality')::brand_formality,    cur.formality),
    COALESCE((p_fields->>'point_of_view')::brand_pov,      cur.point_of_view),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'preferred_vocabulary')),
      cur.preferred_vocabulary
    ),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'avoided_terms')),
      cur.avoided_terms
    ),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'voice_examples')),
      cur.voice_examples
    ),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'focus_topics')),
      cur.focus_topics
    ),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'avoided_topics')),
      cur.avoided_topics
    ),
    COALESCE((p_fields->>'industry'), cur.industry),
    COALESCE((p_fields->>'default_approval_required')::boolean, cur.default_approval_required),
    COALESCE((p_fields->>'default_approval_rule')::social_approval_rule, cur.default_approval_rule),
    COALESCE((p_fields->'platform_overrides'), cur.platform_overrides),
    COALESCE((p_fields->>'hashtag_strategy')::brand_hashtag,   cur.hashtag_strategy),
    COALESCE((p_fields->>'max_post_length')::brand_post_length, cur.max_post_length),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_fields->'content_restrictions')),
      cur.content_restrictions
    )
  ) RETURNING * INTO nxt;

  RETURN nxt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- RLS — new tables
-- =============================================================================

ALTER TABLE platform_brand_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_product_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_generation_log           ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_profiles_read         ON platform_brand_profiles FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY brand_profiles_admin_write  ON platform_brand_profiles FOR ALL
  USING (is_opollo_staff() OR has_company_role(company_id, 'admin'))
  WITH CHECK (is_opollo_staff() OR has_company_role(company_id, 'admin'));

CREATE POLICY product_subs_read           ON platform_product_subscriptions FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY product_subs_staff_write    ON platform_product_subscriptions FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

CREATE POLICY image_log_read              ON image_generation_log FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY image_log_insert            ON image_generation_log FOR INSERT
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

-- =============================================================================
-- SEED — Opollo internal company brand profile + product subscriptions
-- =============================================================================
-- Idempotent: ON CONFLICT DO NOTHING gates re-application. The Opollo
-- internal company is seeded by 0070 with id 00000000-0000-0000-0000-000000000001.

INSERT INTO platform_brand_profiles (
  company_id, version, is_active, change_summary,
  primary_colour, secondary_colour, heading_font, industry,
  formality, point_of_view
)
SELECT id, 1, true, 'Initial brand profile',
       '#FF03A5', '#00E5A0', 'EmBauhausW00', 'Technology / SaaS',
       'semi_formal', 'first_person'
  FROM platform_companies
 WHERE is_opollo_internal = true
ON CONFLICT DO NOTHING;

INSERT INTO platform_product_subscriptions (company_id, product, notes)
SELECT c.id, p.product, 'Opollo internal'
  FROM platform_companies c,
       (VALUES
         ('site_builder'::opollo_product),
         ('social'::opollo_product),
         ('cap'::opollo_product),
         ('blog'::opollo_product),
         ('email'::opollo_product)
       ) AS p(product)
 WHERE c.is_opollo_internal = true
ON CONFLICT (company_id, product) DO NOTHING;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
