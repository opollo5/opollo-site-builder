-- =============================================================================
-- 0070 — Opollo Site Builder Platform Layer + N-Series Social Module schema.
-- Reference: P1 Platform Foundation (BUILD.md). Parent plan in PR description.
-- =============================================================================
-- Creates:
--   1. Platform layer (companies, users, roles, invitations, notifications)
--   2. N-Series social module schema (full table set; feature code lands in S1+)
--
-- Layer ownership (see .claude/skills/n-series-layer-rules):
--   P  Platform:    platform_companies, platform_users, platform_company_users,
--                   platform_invitations, platform_notifications
--   L1 Editorial:   social_post_master, social_post_variant, social_media_assets
--   L2 Approval:    social_approval_requests, social_approval_recipients,
--                   social_approval_events, social_viewer_links
--   L3 Scheduling:  social_schedule_entries, social_publish_jobs
--   L4 Publishing:  social_publish_attempts
--   L5 Connections: social_connections, social_connection_alerts
--   L6 Reliability: social_webhook_events
--
-- Write-safety hotspots addressed:
--   - Singleton index `idx_companies_one_internal` enforces exactly one
--     is_opollo_internal=true row at the schema layer (app can't accidentally
--     create a second "Opollo Internal" company on a race).
--   - UNIQUE (user_id) on platform_company_users encodes the V1 "one user
--     belongs to exactly one company" rule at the schema layer.
--   - UNIQUE partial index `idx_invitations_unique_pending` prevents two
--     concurrent invitations to the same email for the same company.
--   - UNIQUE (post_master_id, platform) on social_post_variant prevents
--     duplicate variant rows per platform per post.
--   - UNIQUE (event_id) on social_webhook_events is the bundle.social
--     idempotency anchor — ON CONFLICT becomes the dedup mechanism.
--   - UNIQUE (bundle_social_account_id) on social_connections prevents
--     reconnect flows from inserting a second row for the same identity.
--
-- Recovery preamble: an earlier draft of this file lived at
--   supabase/migrations/20260502000000_platform_and_social_v1.sql
-- That file was never committed. If a local environment ran `supabase db push`
-- while the draft was in the migrations folder, the objects below already
-- exist without a schema_migrations row matching this 0070 version. Drop them
-- up front so the CREATEs run cleanly. No production environment is affected.
-- Drops are ordered child-first; CASCADE handles dependents.
DROP TABLE IF EXISTS social_webhook_events CASCADE;
DROP TABLE IF EXISTS social_publish_attempts CASCADE;
DROP TABLE IF EXISTS social_publish_jobs CASCADE;
DROP TABLE IF EXISTS social_schedule_entries CASCADE;
DROP TABLE IF EXISTS social_viewer_links CASCADE;
DROP TABLE IF EXISTS social_approval_events CASCADE;
DROP TABLE IF EXISTS social_approval_recipients CASCADE;
DROP TABLE IF EXISTS social_approval_requests CASCADE;
DROP TABLE IF EXISTS social_media_assets CASCADE;
DROP TABLE IF EXISTS social_post_variant CASCADE;
DROP TABLE IF EXISTS social_post_master CASCADE;
DROP TABLE IF EXISTS social_connection_alerts CASCADE;
DROP TABLE IF EXISTS social_connections CASCADE;
DROP TABLE IF EXISTS platform_notifications CASCADE;
DROP TABLE IF EXISTS platform_invitations CASCADE;
DROP TABLE IF EXISTS platform_company_users CASCADE;
DROP TABLE IF EXISTS platform_users CASCADE;
DROP TABLE IF EXISTS platform_companies CASCADE;
DROP FUNCTION IF EXISTS is_opollo_staff() CASCADE;
DROP FUNCTION IF EXISTS is_company_member(UUID) CASCADE;
DROP FUNCTION IF EXISTS current_user_company() CASCADE;
DROP FUNCTION IF EXISTS track_post_state_change() CASCADE;
-- has_company_role / type-dependent functions drop with their type via CASCADE.
DROP TYPE IF EXISTS platform_company_role CASCADE;
DROP TYPE IF EXISTS platform_invitation_status CASCADE;
DROP TYPE IF EXISTS platform_notification_type CASCADE;
DROP TYPE IF EXISTS social_platform CASCADE;
DROP TYPE IF EXISTS social_post_state CASCADE;
DROP TYPE IF EXISTS social_post_source CASCADE;
DROP TYPE IF EXISTS social_connection_status CASCADE;
DROP TYPE IF EXISTS social_approval_rule CASCADE;
DROP TYPE IF EXISTS social_approval_event_type CASCADE;
DROP TYPE IF EXISTS social_attempt_status CASCADE;
DROP TYPE IF EXISTS social_error_class CASCADE;
DROP TYPE IF EXISTS social_alert_severity CASCADE;
-- set_updated_at() trigger function: not dropped here. CREATE OR REPLACE
-- below handles both fresh apply and re-apply paths cleanly.
-- =============================================================================

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Platform role enum
CREATE TYPE platform_company_role AS ENUM (
  'admin',     -- manages company + users + connections
  'approver',  -- approves content
  'editor',    -- drafts content
  'viewer'     -- read-only
);

CREATE TYPE platform_invitation_status AS ENUM (
  'pending',
  'accepted',
  'expired',
  'revoked'
);

CREATE TYPE platform_notification_type AS ENUM (
  'invitation_sent',
  'invitation_reminder',
  'invitation_expired',
  'invitation_accepted',
  'approval_requested',
  'approval_decided',
  'connection_lost',
  'connection_restored',
  'post_published',
  'post_failed',
  'changes_requested'
);

-- Social enums
CREATE TYPE social_platform AS ENUM (
  'linkedin_personal',
  'linkedin_company',
  'facebook_page',
  'x',
  'gbp'
);

CREATE TYPE social_post_state AS ENUM (
  'draft',
  'pending_client_approval',
  'approved',
  'rejected',
  'changes_requested',
  'pending_msp_release',
  'scheduled',
  'publishing',
  'published',
  'failed'
);

CREATE TYPE social_post_source AS ENUM (
  'manual',
  'csv',
  'cap',
  'api'
);

CREATE TYPE social_connection_status AS ENUM (
  'healthy',
  'degraded',
  'auth_required',
  'disconnected'
);

CREATE TYPE social_approval_rule AS ENUM (
  'any_one',
  'all_must'
);

CREATE TYPE social_approval_event_type AS ENUM (
  'submitted',
  'viewed',
  'identity_bound',
  'comment_added',
  'approved',
  'rejected',
  'changes_requested',
  'expired',
  'revoked'
);

CREATE TYPE social_attempt_status AS ENUM (
  'pending',
  'in_flight',
  'unknown',
  'succeeded',
  'failed',
  'reconciling'
);

CREATE TYPE social_error_class AS ENUM (
  'network',
  'rate_limit',
  'platform_error',
  'auth',
  'content_rejected',
  'media_invalid',
  'unknown'
);

CREATE TYPE social_alert_severity AS ENUM (
  'info',
  'warning',
  'critical'
);

-- =============================================================================
-- P — PLATFORM LAYER
-- =============================================================================

CREATE TABLE platform_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT, -- customer's brand domain, e.g. 'skyview.com'
  timezone TEXT NOT NULL DEFAULT 'Australia/Melbourne',
  is_opollo_internal BOOLEAN NOT NULL DEFAULT false, -- true for the Opollo internal company
  approval_default_required BOOLEAN NOT NULL DEFAULT true,
  approval_default_rule social_approval_rule NOT NULL DEFAULT 'any_one',
  concurrent_publish_limit INTEGER NOT NULL DEFAULT 5,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_domain ON platform_companies(domain) WHERE domain IS NOT NULL;
CREATE UNIQUE INDEX idx_companies_one_internal ON platform_companies((1)) WHERE is_opollo_internal = true;

CREATE TABLE platform_users (
  -- Profile data extending auth.users. Created on invitation acceptance.
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  is_opollo_staff BOOLEAN NOT NULL DEFAULT false,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_opollo_staff ON platform_users(is_opollo_staff) WHERE is_opollo_staff = true;

CREATE TABLE platform_company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  role platform_company_role NOT NULL,
  added_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- V1 constraint: one user belongs to exactly one company
  UNIQUE (user_id),
  UNIQUE (company_id, user_id)
);
CREATE INDEX idx_company_users_company ON platform_company_users(company_id);
CREATE INDEX idx_company_users_user ON platform_company_users(user_id);
CREATE INDEX idx_company_users_role ON platform_company_users(company_id, role);

CREATE TABLE platform_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role platform_company_role NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status platform_invitation_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  expired_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitations_company ON platform_invitations(company_id);
CREATE INDEX idx_invitations_email ON platform_invitations(email);
CREATE INDEX idx_invitations_pending ON platform_invitations(status) WHERE status = 'pending';
-- Prevent duplicate active invitations to the same email for the same company
CREATE UNIQUE INDEX idx_invitations_unique_pending
  ON platform_invitations(company_id, email)
  WHERE status = 'pending';

CREATE TABLE platform_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES platform_companies(id) ON DELETE CASCADE,
  type platform_notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  action_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON platform_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_all ON platform_notifications(user_id, created_at DESC);

-- =============================================================================
-- PLATFORM AUTH HELPERS
-- =============================================================================

-- Is the current user Opollo staff?
CREATE OR REPLACE FUNCTION is_opollo_staff()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_opollo_staff FROM platform_users WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Is the current user a member of this company?
CREATE OR REPLACE FUNCTION is_company_member(company UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_company_users
    WHERE company_id = company
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Does the current user have at least this role in this company?
CREATE OR REPLACE FUNCTION has_company_role(company UUID, min_role platform_company_role)
RETURNS BOOLEAN AS $$
DECLARE
  user_role platform_company_role;
  role_rank INT;
  min_rank INT;
BEGIN
  SELECT role INTO user_role
  FROM platform_company_users
  WHERE company_id = company AND user_id = auth.uid();

  IF user_role IS NULL THEN
    RETURN false;
  END IF;

  -- Role hierarchy: admin > approver > editor > viewer
  role_rank := CASE user_role
    WHEN 'admin' THEN 4
    WHEN 'approver' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
  END;

  min_rank := CASE min_role
    WHEN 'admin' THEN 4
    WHEN 'approver' THEN 3
    WHEN 'editor' THEN 2
    WHEN 'viewer' THEN 1
  END;

  RETURN role_rank >= min_rank;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Get the current user's company (V1: one company per user)
CREATE OR REPLACE FUNCTION current_user_company()
RETURNS UUID AS $$
  SELECT company_id FROM platform_company_users WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =============================================================================
-- L5 — CONNECTIONS (defined before L1 social tables for FK reference)
-- =============================================================================

CREATE TABLE social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  bundle_social_account_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  status social_connection_status NOT NULL DEFAULT 'healthy',
  last_error TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  last_health_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_connections_company ON social_connections(company_id);
CREATE INDEX idx_connections_status ON social_connections(status);

CREATE TABLE social_connection_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  severity social_alert_severity NOT NULL,
  message TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_connection_alerts_unresolved ON social_connection_alerts(company_id) WHERE resolved_at IS NULL;

-- =============================================================================
-- L1 — EDITORIAL
-- =============================================================================

CREATE TABLE social_post_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  state social_post_state NOT NULL DEFAULT 'draft',
  source_type social_post_source NOT NULL DEFAULT 'manual',
  master_text TEXT,
  link_url TEXT,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_master_company_state ON social_post_master(company_id, state);
CREATE INDEX idx_post_master_state_changed ON social_post_master(state_changed_at);

CREATE TABLE social_post_variant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_master_id UUID NOT NULL REFERENCES social_post_master(id) ON DELETE CASCADE,
  platform social_platform NOT NULL,
  connection_id UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  variant_text TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT false,
  scheduled_at TIMESTAMPTZ,
  media_asset_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_master_id, platform)
);
CREATE INDEX idx_post_variant_master ON social_post_variant(post_master_id);
CREATE INDEX idx_post_variant_scheduled ON social_post_variant(scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE social_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,
  derived_versions JSONB DEFAULT '{}'::jsonb,
  uploaded_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_company ON social_media_assets(company_id);

-- =============================================================================
-- L2 — APPROVAL
-- =============================================================================

CREATE TABLE social_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_master_id UUID NOT NULL REFERENCES social_post_master(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  approval_rule social_approval_rule NOT NULL,
  snapshot_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  -- Denormalised audit fields
  final_approved_by_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL, -- if reviewer is platform user
  final_approved_by_email TEXT, -- always populated (works for platform users + magic-link external)
  final_approved_by_name TEXT,
  final_approved_at TIMESTAMPTZ,
  final_rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_requests_post ON social_approval_requests(post_master_id);
CREATE INDEX idx_approval_requests_company ON social_approval_requests(company_id);

CREATE TABLE social_approval_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES social_approval_requests(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  -- If recipient is a platform user, link them. Otherwise null (one-off external).
  platform_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  requires_otp BOOLEAN NOT NULL DEFAULT false,
  otp_code_hash TEXT,
  otp_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_recipients_request ON social_approval_recipients(approval_request_id);
CREATE INDEX idx_approval_recipients_token_hash ON social_approval_recipients(token_hash);
CREATE INDEX idx_approval_recipients_user ON social_approval_recipients(platform_user_id) WHERE platform_user_id IS NOT NULL;

CREATE TABLE social_approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES social_approval_requests(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES social_approval_recipients(id) ON DELETE SET NULL,
  event_type social_approval_event_type NOT NULL,
  platform social_platform,
  comment_text TEXT,
  -- Identity captured at event time (auth session for users, soft-bound for non-users)
  actor_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  bound_identity_name TEXT,
  bound_identity_email TEXT,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_events_request ON social_approval_events(approval_request_id, occurred_at);

CREATE TABLE social_viewer_links (
  -- 90-day magic links for customer-facing read-only calendar
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_email TEXT,
  recipient_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  created_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_viewer_links_company ON social_viewer_links(company_id);

-- =============================================================================
-- L3 — SCHEDULING
-- =============================================================================

CREATE TABLE social_schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_variant_id UUID NOT NULL REFERENCES social_post_variant(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  qstash_message_id TEXT,
  scheduled_by UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX idx_schedule_entries_variant ON social_schedule_entries(post_variant_id);
CREATE INDEX idx_schedule_entries_pending ON social_schedule_entries(scheduled_at) WHERE cancelled_at IS NULL;

CREATE TABLE social_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_entry_id UUID REFERENCES social_schedule_entries(id) ON DELETE SET NULL,
  post_variant_id UUID NOT NULL REFERENCES social_post_variant(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  fire_at TIMESTAMPTZ NOT NULL,
  fired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_publish_jobs_pending ON social_publish_jobs(fire_at) WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- =============================================================================
-- L4 — PUBLISHING
-- =============================================================================

CREATE TABLE social_publish_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_job_id UUID NOT NULL REFERENCES social_publish_jobs(id) ON DELETE CASCADE,
  post_variant_id UUID NOT NULL REFERENCES social_post_variant(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES social_connections(id),
  status social_attempt_status NOT NULL DEFAULT 'pending',
  bundle_post_id TEXT,
  platform_post_url TEXT,
  error_class social_error_class,
  error_payload JSONB,
  request_payload JSONB,
  response_payload JSONB,
  original_attempt_id UUID REFERENCES social_publish_attempts(id),
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_attempts_job ON social_publish_attempts(publish_job_id);
CREATE INDEX idx_attempts_in_flight ON social_publish_attempts(started_at)
  WHERE status IN ('pending', 'in_flight', 'unknown');
CREATE INDEX idx_attempts_bundle_post ON social_publish_attempts(bundle_post_id) WHERE bundle_post_id IS NOT NULL;

-- =============================================================================
-- L6 — RELIABILITY
-- =============================================================================

CREATE TABLE social_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_webhook_events_received ON social_webhook_events(received_at);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON platform_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON platform_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_post_master_updated BEFORE UPDATE ON social_post_master
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_post_variant_updated BEFORE UPDATE ON social_post_variant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_connections_updated BEFORE UPDATE ON social_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION track_post_state_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_post_master_state_change BEFORE UPDATE ON social_post_master
  FOR EACH ROW EXECUTE FUNCTION track_post_state_change();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Three access patterns:
--   1. Opollo staff → see everything (is_opollo_staff() = true)
--   2. Company members → see only their company's data (is_company_member())
--   3. External (approval/viewer tokens) → handled via RPC, not RLS

ALTER TABLE platform_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_connection_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_variant ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_approval_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_viewer_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_webhook_events ENABLE ROW LEVEL SECURITY;

-- Platform layer policies
CREATE POLICY companies_read ON platform_companies FOR SELECT
  USING (is_opollo_staff() OR is_company_member(id));
CREATE POLICY companies_write ON platform_companies FOR ALL
  USING (is_opollo_staff()) WITH CHECK (is_opollo_staff());

CREATE POLICY users_read ON platform_users FOR SELECT
  USING (
    is_opollo_staff()
    OR id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM platform_company_users a
      JOIN platform_company_users b ON a.company_id = b.company_id
      WHERE a.user_id = auth.uid() AND b.user_id = platform_users.id
    )
  );
CREATE POLICY users_self_update ON platform_users FOR UPDATE
  USING (id = auth.uid() OR is_opollo_staff())
  WITH CHECK (id = auth.uid() OR is_opollo_staff());

CREATE POLICY company_users_read ON platform_company_users FOR SELECT
  USING (is_opollo_staff() OR is_company_member(company_id));
CREATE POLICY company_users_admin_write ON platform_company_users FOR ALL
  USING (is_opollo_staff() OR has_company_role(company_id, 'admin'))
  WITH CHECK (is_opollo_staff() OR has_company_role(company_id, 'admin'));

CREATE POLICY invitations_admin_access ON platform_invitations FOR ALL
  USING (is_opollo_staff() OR has_company_role(company_id, 'admin'))
  WITH CHECK (is_opollo_staff() OR has_company_role(company_id, 'admin'));

CREATE POLICY notifications_self_read ON platform_notifications FOR SELECT
  USING (user_id = auth.uid() OR is_opollo_staff());
CREATE POLICY notifications_self_update ON platform_notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Social layer policies — most are "any company member can read/write"
-- Application layer enforces role-based action permissions on top
CREATE POLICY connections_access ON social_connections FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY connection_alerts_access ON social_connection_alerts FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY post_master_access ON social_post_master FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY post_variant_access ON social_post_variant FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_post_master m
      WHERE m.id = post_master_id AND is_company_member(m.company_id)
    )
  )
  WITH CHECK (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_post_master m
      WHERE m.id = post_master_id AND is_company_member(m.company_id)
    )
  );

CREATE POLICY media_access ON social_media_assets FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY approval_requests_access ON social_approval_requests FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id))
  WITH CHECK (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY approval_recipients_access ON social_approval_recipients FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  );

CREATE POLICY approval_events_access ON social_approval_events FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_approval_requests r
      WHERE r.id = approval_request_id AND is_company_member(r.company_id)
    )
  );

CREATE POLICY viewer_links_access ON social_viewer_links FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY schedule_entries_access ON social_schedule_entries FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_post_variant v
      JOIN social_post_master m ON m.id = v.post_master_id
      WHERE v.id = post_variant_id AND is_company_member(m.company_id)
    )
  );

CREATE POLICY publish_jobs_access ON social_publish_jobs FOR ALL
  USING (is_opollo_staff() OR is_company_member(company_id));

CREATE POLICY publish_attempts_access ON social_publish_attempts FOR ALL
  USING (
    is_opollo_staff() OR EXISTS (
      SELECT 1 FROM social_publish_jobs j
      WHERE j.id = publish_job_id AND is_company_member(j.company_id)
    )
  );

-- Webhook events: staff only
CREATE POLICY webhook_events_staff_only ON social_webhook_events FOR ALL
  USING (is_opollo_staff());

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE platform_companies IS 'P — customer companies. is_opollo_internal=true for the Opollo internal company.';
COMMENT ON TABLE platform_users IS 'P — profile data extending auth.users. Created on invitation acceptance.';
COMMENT ON TABLE platform_company_users IS 'P — membership + role. UNIQUE(user_id) enforces "one company per user" V1 constraint.';
COMMENT ON TABLE platform_invitations IS 'P — invitation lifecycle with day-3 reminder and day-14 expiry tracking.';
COMMENT ON TABLE platform_notifications IS 'P — in-app notifications. Email-only notifications do not require a row.';
COMMENT ON TABLE social_post_master IS 'L1 — editorial object, owns the state machine.';
COMMENT ON TABLE social_approval_requests IS 'L2 — snapshot-bound approval. snapshot_payload is immutable after creation.';
COMMENT ON COLUMN social_approval_requests.final_approved_by_user_id IS 'Set if reviewer was a platform user. NULL for one-off external reviewers.';
COMMENT ON COLUMN social_approval_recipients.platform_user_id IS 'Linked if recipient is a platform user. NULL for one-off external reviewers.';
COMMENT ON TABLE social_publish_jobs IS 'L3-owned — only L3 may insert rows. L4 reads and executes.';
COMMENT ON TABLE social_publish_attempts IS 'L4 — one row per actual call to bundle.social. Immutable audit log.';
COMMENT ON TABLE social_webhook_events IS 'L6 — idempotency log. event_id unique constraint prevents double-processing.';

-- =============================================================================
-- SEED: Opollo Internal Company
-- =============================================================================
-- Fixed UUID 00000000-0000-0000-0000-000000000001 — easy to recognise in
-- dev/debug, idempotent on re-apply. The is_opollo_internal singleton index
-- prevents a second internal company even if this INSERT ever ran twice;
-- ON CONFLICT (id) makes the re-apply path a no-op rather than an error.
--
-- After migration, create the first Opollo staff user via Supabase Auth and
-- link them:
--   INSERT INTO platform_users (id, email, full_name, is_opollo_staff)
--   VALUES (<auth.users.id>, 'hi@opollo.com', 'Steven', true);
--   INSERT INTO platform_company_users (company_id, user_id, role)
--   VALUES ('00000000-0000-0000-0000-000000000001', <user_id>, 'admin');

INSERT INTO platform_companies (id, name, slug, is_opollo_internal, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Opollo',
  'opollo',
  true,
  'Australia/Melbourne'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
