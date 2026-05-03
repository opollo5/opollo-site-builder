-- Rollback for 0082_m16_site_graph.sql
-- Drops the three new tables, the additive columns on pages and
-- design_components, all associated indexes, policies, and triggers.
-- Does NOT restore any row data. Intended for local dev / CI reset only.

-- ─── Triggers ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS shared_content_updated_at  ON shared_content;
DROP TRIGGER IF EXISTS route_registry_updated_at  ON route_registry;
DROP TRIGGER IF EXISTS site_blueprints_updated_at ON site_blueprints;

-- ─── RLS policies ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "shared_content_write"   ON shared_content;
DROP POLICY IF EXISTS "shared_content_select"  ON shared_content;
DROP POLICY IF EXISTS "route_registry_write"   ON route_registry;
DROP POLICY IF EXISTS "route_registry_select"  ON route_registry;
DROP POLICY IF EXISTS "site_blueprints_write"  ON site_blueprints;
DROP POLICY IF EXISTS "site_blueprints_select" ON site_blueprints;

-- ─── design_components additive columns ───────────────────────────────────

ALTER TABLE design_components
  DROP COLUMN IF EXISTS allowed_ref_types,
  DROP COLUMN IF EXISTS default_props,
  DROP COLUMN IF EXISTS puck_fields;

-- ─── pages additive columns ───────────────────────────────────────────────

DROP INDEX IF EXISTS idx_pages_wp_status;
DROP INDEX IF EXISTS idx_pages_html_is_stale;

ALTER TABLE pages
  DROP COLUMN IF EXISTS wp_status,
  DROP COLUMN IF EXISTS validation_result,
  DROP COLUMN IF EXISTS html_is_stale,
  DROP COLUMN IF EXISTS page_document;

-- ─── shared_content ───────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_shared_content_active;
DROP INDEX IF EXISTS idx_shared_content_type;
DROP INDEX IF EXISTS idx_shared_content_site_id;
DROP TABLE IF EXISTS shared_content;

-- ─── route_registry ───────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_route_registry_status;
DROP INDEX IF EXISTS idx_route_registry_site_id;
DROP INDEX IF EXISTS idx_route_registry_active_slug;
DROP TABLE IF EXISTS route_registry;

-- ─── site_blueprints ──────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_site_blueprints_site_id;
DROP TABLE IF EXISTS site_blueprints;
