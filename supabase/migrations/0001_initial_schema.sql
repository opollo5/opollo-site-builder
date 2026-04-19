-- Week 2 Stage 1a — Initial schema
-- Reference: docs/WEEK2_ARCHITECTURE_v2.md §6 (added in a follow-up commit)
--
-- Design decisions encoded here:
--
-- 1. Soft-delete pattern on sites.status = 'removed'. We never hard-delete
--    rows from sites. History tables therefore use ON DELETE RESTRICT on
--    their site_id FKs — if someone ever hard-deletes a site, they must
--    explicitly deal with history first.
--
-- 2. Owned, 1:1-with-site data (site_credentials, site_context,
--    pairing_codes) uses ON DELETE CASCADE — if the site row is ever
--    hard-deleted, these go too.
--
-- 3. Scope prefix uniqueness is enforced via a partial unique index that
--    excludes removed sites, so a removed site's prefix can be reused.
--
-- 4. RLS is enabled on every table. Stage 1a only adds service_role policies
--    (our backend is the sole caller). Stage 2 will add user-scoped policies
--    when Supabase Auth ships.
--
-- 5. chat_sessions.message_count has CHECK (message_count <= 200), enforcing
--    the 200 hard boundary at the DB layer. The app archives before this.

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

CREATE TYPE site_status AS ENUM (
  'pending_pairing',
  'active',
  'paused',
  'removed'
);

CREATE TYPE health_status AS ENUM (
  'pass',
  'fail',
  'degraded'
);

-- ----------------------------------------------------------------------------
-- sites
-- ----------------------------------------------------------------------------

CREATE TABLE sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  wp_url text NOT NULL,
  prefix varchar(4) NOT NULL
    CHECK (prefix ~ '^[a-z0-9]{2,4}$'),
  design_system_version text NOT NULL DEFAULT '1.0.0',
  status site_status NOT NULL DEFAULT 'pending_pairing',
  last_successful_operation_at timestamptz,
  plugin_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Scope prefix must be unique among non-removed sites.
CREATE UNIQUE INDEX sites_prefix_active_uniq
  ON sites (prefix)
  WHERE status != 'removed';

CREATE INDEX sites_status_idx ON sites (status);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON sites
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- site_credentials
-- ----------------------------------------------------------------------------

CREATE TABLE site_credentials (
  site_id uuid PRIMARY KEY
    REFERENCES sites(id) ON DELETE CASCADE,
  wp_user text NOT NULL,
  site_secret_encrypted bytea NOT NULL,
  iv bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1
    CHECK (key_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE site_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON site_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- pairing_codes
-- ----------------------------------------------------------------------------

CREATE TABLE pairing_codes (
  code text PRIMARY KEY,
  site_id uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pairing_codes_site_idx ON pairing_codes (site_id);
CREATE INDEX pairing_codes_expires_idx ON pairing_codes (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON pairing_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- site_context
-- ----------------------------------------------------------------------------

CREATE TABLE site_context (
  site_id uuid PRIMARY KEY
    REFERENCES sites(id) ON DELETE CASCADE,
  pages_tree jsonb NOT NULL DEFAULT '[]'::jsonb,
  menus_current jsonb NOT NULL DEFAULT '{}'::jsonb,
  homepage_id bigint,
  templates_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_recent_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE site_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON site_context
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- page_history
-- Immutable audit log of every create/update/publish/delete operation.
-- ON DELETE RESTRICT: history must persist if a site is ever hard-deleted.
-- ----------------------------------------------------------------------------

CREATE TABLE page_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL
    REFERENCES sites(id) ON DELETE RESTRICT,
  page_id bigint,
  operation text NOT NULL
    CHECK (operation IN ('create', 'update', 'publish', 'unpublish', 'delete')),
  operator_user_id uuid,
  updated_by text,
  plugin_version text,
  http_status integer,
  request_payload jsonb,
  response_envelope jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX page_history_site_created_idx
  ON page_history (site_id, created_at DESC);
CREATE INDEX page_history_page_idx
  ON page_history (site_id, page_id)
  WHERE page_id IS NOT NULL;

ALTER TABLE page_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON page_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- chat_sessions
-- Live conversation state. 200 message soft limit enforced via CHECK.
-- ON DELETE RESTRICT on site_id for the same reason as page_history.
-- ----------------------------------------------------------------------------

CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL
    REFERENCES sites(id) ON DELETE RESTRICT,
  user_id uuid,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_count integer NOT NULL DEFAULT 0
    CHECK (message_count >= 0 AND message_count <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_sessions_site_updated_idx
  ON chat_sessions (site_id, updated_at DESC);
CREATE INDEX chat_sessions_user_idx
  ON chat_sessions (user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON chat_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- chat_sessions_archive
-- Sessions retained after archival. Same schema + archived_at.
-- ----------------------------------------------------------------------------

CREATE TABLE chat_sessions_archive (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL
    REFERENCES sites(id) ON DELETE RESTRICT,
  user_id uuid,
  messages jsonb NOT NULL,
  message_count integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_sessions_archive_site_archived_idx
  ON chat_sessions_archive (site_id, archived_at DESC);

ALTER TABLE chat_sessions_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON chat_sessions_archive
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- health_checks
-- Periodic connectivity probes. RESTRICT to preserve history.
-- ----------------------------------------------------------------------------

CREATE TABLE health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL
    REFERENCES sites(id) ON DELETE RESTRICT,
  status health_status NOT NULL,
  http_status integer,
  plugin_version text,
  details jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX health_checks_site_checked_idx
  ON health_checks (site_id, checked_at DESC);

ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON health_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
