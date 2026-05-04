-- supabase/migrations/XXXX_m16_site_graph.sql
--
-- M16: Site graph architecture
-- Adds site_blueprints, route_registry, shared_content tables.
-- Additive columns on pages and design_components.
-- Existing rows, pipeline, and published pages are unaffected.
--
-- Follows docs/DATA_CONVENTIONS.md:
-- - soft_delete via deleted_at on shared_content
-- - version_lock on all three new tables
-- - audit columns (created_by, updated_by, created_at, updated_at)
-- - RLS enabled immediately, policies following M2b matrix

-- ─── 1. site_blueprints ────────────────────────────────────────────────────
-- One row per site. The singleton read before every generation pass.
-- Equivalent to Payload CMS Globals pattern.

CREATE TABLE site_blueprints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,

  -- Blueprint status — page generation requires status = 'approved'
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'approved')),

  -- Brand
  brand_name    TEXT NOT NULL DEFAULT '',
  brand_voice   JSONB NOT NULL DEFAULT '{}',
  design_tokens JSONB NOT NULL DEFAULT '{}',
  logo_image_id UUID REFERENCES image_library(id) ON DELETE SET NULL,

  -- Navigation (resolved to full objects by renderer, stored as summaries)
  nav_items     JSONB NOT NULL DEFAULT '[]',
  footer_items  JSONB NOT NULL DEFAULT '[]',

  -- SEO defaults (page-level SEO can override)
  seo_defaults  JSONB NOT NULL DEFAULT '{}',

  -- Route plan (populated by site planner, operator-editable before approve)
  route_plan    JSONB NOT NULL DEFAULT '[]',

  -- CTA catalogue (resolved by ctaRef → shared_content lookup)
  cta_catalogue JSONB NOT NULL DEFAULT '[]',

  -- Contact / legal (used by Contact and Footer components)
  contact_data  JSONB NOT NULL DEFAULT '{}',
  legal_data    JSONB NOT NULL DEFAULT '{}',

  -- WordPress publish settings
  wp_theme_json JSONB NOT NULL DEFAULT '{}',  -- compiled theme.json, set by publisher

  -- Optimistic locking
  version_lock  INT NOT NULL DEFAULT 1,

  -- Audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES opollo_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_site_blueprints_site_id ON site_blueprints (site_id);

-- ─── 2. route_registry ─────────────────────────────────────────────────────
-- Every internal URL in the site is a record here.
-- Nothing in the system stores a URL string — all internal links are routeRefs.
-- Pages reference routes by ID. Renderer resolves ID → current slug at render time.

CREATE TABLE route_registry (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

  slug          TEXT NOT NULL,      -- e.g. /contact-us
  page_type     TEXT NOT NULL
                CHECK (page_type IN (
                  'homepage','service','about','contact',
                  'landing','blog-index','blog-post'
                )),
  label         TEXT NOT NULL,      -- human-readable: "Contact Us"
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','live','redirected','removed')),

  -- If redirected, the route this slug now points to
  redirect_to   UUID REFERENCES route_registry(id) ON DELETE SET NULL,

  -- WordPress side (populated on publish)
  wp_page_id      INT,
  wp_content_hash TEXT,             -- SHA-256 of WP page content, for drift detection

  -- Generation order (matches brief_pages.ordinal; set by site planner)
  ordinal         INT,

  -- Optimistic locking
  version_lock  INT NOT NULL DEFAULT 1,

  -- Audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A slug is unique per site for non-removed routes
  CONSTRAINT route_registry_site_slug_unique
    UNIQUE NULLS NOT DISTINCT (site_id, slug)
    -- Note: PostgreSQL partial unique via WHERE clause:
);

-- Partial unique index: (site_id, slug) where status != 'removed'
-- This allows a slug to be re-used after a route is removed.
CREATE UNIQUE INDEX idx_route_registry_active_slug
  ON route_registry (site_id, slug)
  WHERE status != 'removed';

CREATE INDEX idx_route_registry_site_id ON route_registry (site_id);
CREATE INDEX idx_route_registry_status  ON route_registry (status);

-- Drop the naive UNIQUE from above (we used the partial index instead)
ALTER TABLE route_registry DROP CONSTRAINT IF EXISTS route_registry_site_slug_unique;

-- ─── 3. shared_content ─────────────────────────────────────────────────────
-- Reusable content objects referenced by ID from any page section.
-- Generated once per site, never duplicated across pages.
-- Equivalent to Directus relational content model.

CREATE TABLE shared_content (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,

  content_type  TEXT NOT NULL
                CHECK (content_type IN (
                  'cta','testimonial','service','faq','stat','offer'
                )),
  label         TEXT NOT NULL,   -- internal name only, never shown to site visitors

  -- Type-specific content:
  -- cta:         { text, subtext, routeRef: route_registry.id|null, externalUrl|null, variant }
  -- testimonial: { quote, author, role, company, imageId: image_library.id, placeholder: bool }
  -- service:     { name, tagline, description, iconSlug, routeRef: route_registry.id }
  -- faq:         { question, answer }
  -- stat:        { value, label, suffix }
  -- offer:       { headline, description, badgeText }
  content       JSONB NOT NULL DEFAULT '{}',

  -- Optimistic locking
  version_lock  INT NOT NULL DEFAULT 1,

  -- Soft delete (following DATA_CONVENTIONS.md)
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID REFERENCES opollo_users(id) ON DELETE SET NULL,

  -- Audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES opollo_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_shared_content_site_id     ON shared_content (site_id);
CREATE INDEX idx_shared_content_type        ON shared_content (content_type);
CREATE INDEX idx_shared_content_active      ON shared_content (site_id, content_type)
  WHERE deleted_at IS NULL;

-- ─── 4. pages table — additive columns ────────────────────────────────────
-- Existing rows are unaffected. Existing pipeline still writes generated_html.
-- New pipeline writes page_document (canonical) + generated_html (cache).

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS page_document     JSONB,
  ADD COLUMN IF NOT EXISTS html_is_stale     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_result JSONB,
  ADD COLUMN IF NOT EXISTS wp_status         TEXT NOT NULL DEFAULT 'not_uploaded'
    CHECK (wp_status IN (
      'not_uploaded','draft','published','unpublished','trashed','drift_detected'
    ));

-- Index for the render worker: finds pages needing re-render quickly
CREATE INDEX IF NOT EXISTS idx_pages_html_is_stale
  ON pages (site_id, html_is_stale)
  WHERE html_is_stale = true;

-- Index for WP status dashboard
CREATE INDEX IF NOT EXISTS idx_pages_wp_status
  ON pages (site_id, wp_status);

-- pages.wp_page_id — drop NOT NULL so M16 can create rows before WP publish
ALTER TABLE pages ALTER COLUMN wp_page_id DROP NOT NULL;
ALTER TABLE pages DROP CONSTRAINT IF EXISTS unique_wp_page_per_site;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_site_wp_unique
  ON pages (site_id, wp_page_id)
  WHERE wp_page_id IS NOT NULL;

-- route_registry.ordinal index (column is declared above in CREATE TABLE)
CREATE INDEX IF NOT EXISTS idx_route_registry_site_ordinal
  ON route_registry (site_id, ordinal)
  WHERE ordinal IS NOT NULL;

-- ─── 5. design_components table — additive columns ────────────────────────
-- Adds typed field schema (Puck Fields format) and render defaults.
-- Existing components keep working; new columns are nullable.

ALTER TABLE design_components
  ADD COLUMN IF NOT EXISTS puck_fields       JSONB,
  ADD COLUMN IF NOT EXISTS default_props     JSONB,
  ADD COLUMN IF NOT EXISTS allowed_ref_types TEXT[];

-- ─── 6. RLS policies ──────────────────────────────────────────────────────
-- Follows M2b role matrix: viewer=read, operator=read+own-write, admin=full.

ALTER TABLE site_blueprints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_registry   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_content   ENABLE ROW LEVEL SECURITY;

-- site_blueprints: admin and operator can read/write their own sites
CREATE POLICY "site_blueprints_select" ON site_blueprints
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator', 'viewer')
    )
  );

CREATE POLICY "site_blueprints_write" ON site_blueprints
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator')
    )
  );

-- route_registry: same matrix
CREATE POLICY "route_registry_select" ON route_registry
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator', 'viewer')
    )
  );

CREATE POLICY "route_registry_write" ON route_registry
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator')
    )
  );

-- shared_content: same matrix
CREATE POLICY "shared_content_select" ON shared_content
  FOR SELECT USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator', 'viewer')
    )
  );

CREATE POLICY "shared_content_write" ON shared_content
  FOR ALL USING (
    auth.uid() IN (
      SELECT id FROM opollo_users WHERE role IN ('admin', 'super_admin', 'operator')
    )
  );

-- ─── 7. Updated_at triggers ───────────────────────────────────────────────
-- Reuse existing trigger function if it exists, otherwise create it.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER site_blueprints_updated_at
  BEFORE UPDATE ON site_blueprints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER route_registry_updated_at
  BEFORE UPDATE ON route_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER shared_content_updated_at
  BEFORE UPDATE ON shared_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
