-- M1a — Design system infrastructure schema
-- Reference: docs/m1-claude-code-brief.md §3.3 (full DDL), §3.10 (opollo_users)
--
-- Design decisions encoded here:
--
-- 1. Two "version" columns on design_systems, and they are NOT the same thing:
--      - version       = semantic version of the design system (v1, v2 ...).
--                        Monotonic integer per site. Pages snapshot this.
--      - version_lock  = optimistic concurrency counter (§2.4). Incremented on
--                        every mutating UPDATE. Conflict returns 409.
--    design_components, design_templates, and pages have only version_lock.
--
-- 2. pages.design_system_version is a deliberate point-in-time snapshot, not a
--    live FK. No composite FK to design_systems(site_id, version) — we want to
--    archive old design systems while live pages still reference their version.
--    Drift monitoring (M5) queries this column without FK integrity.
--
-- 3. RLS follows 0001_initial_schema.sql: service-role-only for Stage 1.
--    TODO(M2): add authenticated-role policies once Supabase Auth lands and
--    opollo_users is populated.
--
-- 4. ON DELETE semantics:
--      - CASCADE: design_systems/components/templates down the ownership tree;
--                 pages.site_id (pages are current content, not audit).
--      - SET NULL: pages.template_id, design_systems.created_by,
--                  pages.last_edited_by (referenced row may legitimately be
--                  deleted without invalidating the child).
--    This differs from page_history/chat_sessions (RESTRICT) because those are
--    audit tables whose purpose is to outlive the site.
--
-- 5. opollo_users is created now but not populated until M2. All created_by /
--    last_edited_by columns are NULLABLE so backfill is unnecessary.
--
-- 6. wp_page_id is bigint to match page_history.page_id and site_context
--    .homepage_id. WordPress IDs can exceed INT range on mature installs.
--
-- 7. updated_at is manually set by the application, matching 0001's convention.
--    No triggers — they create debugging surprises.

-- ----------------------------------------------------------------------------
-- opollo_users
-- Referenced by design_systems.created_by and pages.last_edited_by.
-- Populated in M2 alongside the Supabase Auth migration. Until then, the
-- referencing columns are NULL for every row.
-- ----------------------------------------------------------------------------

CREATE TABLE opollo_users (
  id           uuid PRIMARY KEY,  -- will reference auth.users(id) after M2
  email        text UNIQUE NOT NULL,
  display_name text,
  role         text NOT NULL DEFAULT 'operator'
    CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opollo_users ENABLE ROW LEVEL SECURITY;
-- TODO(M2): add authenticated-role policies once Supabase Auth lands.
CREATE POLICY service_role_all ON opollo_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- design_systems
-- One row per (site, semantic version). At most one active version per site.
-- ----------------------------------------------------------------------------

CREATE TABLE design_systems (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  version        integer NOT NULL
    CHECK (version >= 1),
  status         text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  tokens_css     text NOT NULL,
  base_styles    text NOT NULL,
  notes          text,
  created_by     uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  activated_at   timestamptz,
  archived_at    timestamptz,
  version_lock   integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),

  CONSTRAINT one_version_per_site UNIQUE (site_id, version)
);

CREATE UNIQUE INDEX one_active_design_system
  ON design_systems (site_id)
  WHERE status = 'active';

ALTER TABLE design_systems ENABLE ROW LEVEL SECURITY;
-- TODO(M2): add authenticated-role policies once Supabase Auth lands.
CREATE POLICY service_role_all ON design_systems
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- design_components
-- Component registry for a design system. (design_system_id, name, variant)
-- is unique — multiple variants of 'hero-centered' are allowed, duplicates are
-- not.
-- ----------------------------------------------------------------------------

CREATE TABLE design_components (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id  uuid NOT NULL
    REFERENCES design_systems(id) ON DELETE CASCADE,
  name              text NOT NULL,
  variant           text,
  category          text NOT NULL,
  html_template     text NOT NULL,
  css               text NOT NULL,
  content_schema    jsonb NOT NULL,
  image_slots       jsonb,
  usage_notes       text,
  preview_html      text,
  version_lock      integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_component_per_ds UNIQUE (design_system_id, name, variant)
);

CREATE INDEX idx_design_components_ds_category
  ON design_components (design_system_id, category);

ALTER TABLE design_components ENABLE ROW LEVEL SECURITY;
-- TODO(M2): add authenticated-role policies once Supabase Auth lands.
CREATE POLICY service_role_all ON design_components
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- design_templates
-- Page-type composition templates. At most one default template per
-- (design_system, page_type).
-- ----------------------------------------------------------------------------

CREATE TABLE design_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id  uuid NOT NULL
    REFERENCES design_systems(id) ON DELETE CASCADE,
  page_type         text NOT NULL,
  name              text NOT NULL,
  composition       jsonb NOT NULL,
  required_fields   jsonb NOT NULL,
  seo_defaults      jsonb,
  is_default        boolean NOT NULL DEFAULT false,
  version_lock      integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_default_template_per_type
  ON design_templates (design_system_id, page_type)
  WHERE is_default = true;

ALTER TABLE design_templates ENABLE ROW LEVEL SECURITY;
-- TODO(M2): add authenticated-role policies once Supabase Auth lands.
CREATE POLICY service_role_all ON design_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- pages
-- Current page content. Snapshots design_system_version as a loose integer —
-- intentionally not a FK so design systems can be archived while live pages
-- still reference their historical version.
-- ----------------------------------------------------------------------------

CREATE TABLE pages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  wp_page_id             bigint NOT NULL,
  slug                   text NOT NULL,
  title                  text NOT NULL,
  page_type              text NOT NULL,
  template_id            uuid
    REFERENCES design_templates(id) ON DELETE SET NULL,
  design_system_version  integer NOT NULL
    CHECK (design_system_version >= 1),
  content_brief          jsonb,
  content_structured     jsonb,
  generated_html         text,
  status                 text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  last_edited_by         uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,
  version_lock           integer NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_wp_page_per_site UNIQUE (site_id, wp_page_id)
);

CREATE INDEX idx_pages_site_status
  ON pages (site_id, status);

CREATE INDEX idx_pages_design_system_version
  ON pages (site_id, design_system_version);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
-- TODO(M2): add authenticated-role policies once Supabase Auth lands.
CREATE POLICY service_role_all ON pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
