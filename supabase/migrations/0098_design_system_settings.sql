-- 0098 — Design system settings table.
--
-- Stores per-installation overrides for the Opollo design token system.
-- The admin design system settings page (/admin/settings/design-system) reads
-- and writes this table. The root layout injects the active settings as a
-- <style> block of :root CSS variable overrides at render time.
--
-- Design decisions:
--
-- 1. Singleton with optional company_id scope. A NULL company_id row is the
--    global default, applied to all operator surfaces. A non-null company_id
--    row is reserved for future per-company theming. The root layout reads
--    only the global (NULL) row — per-company logic is a follow-up.
--
-- 2. All token columns are nullable. NULL = "use the compiled default from
--    app/globals.css". The app layer only emits CSS variables for columns
--    that have non-null values.
--
-- 3. RLS: service_role only. The root layout uses the service-role client;
--    the admin API uses requireAdminForApi (super_admin gate).
--
-- 4. No hard-delete. The row is never deleted — use UPDATE to reset tokens
--    to NULL (equivalent to "reset to default"). The "Reset to defaults"
--    button in the UI issues a PUT that sets all columns to NULL.

BEGIN;

CREATE TABLE design_system_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL = global default; uuid = future per-company override
  company_id uuid,

  -- ── Colour tokens ─────────────────────────────────────────────────────────
  color_pk      text CHECK (color_pk      ~ '^#[0-9a-fA-F]{3,8}$' OR color_pk      IS NULL),
  color_pk2     text CHECK (color_pk2     ~ '^#[0-9a-fA-F]{3,8}$' OR color_pk2     IS NULL),
  color_gr      text CHECK (color_gr      ~ '^#[0-9a-fA-F]{3,8}$' OR color_gr      IS NULL),
  color_gr2     text CHECK (color_gr2     ~ '^#[0-9a-fA-F]{3,8}$' OR color_gr2     IS NULL),
  color_bl      text CHECK (color_bl      ~ '^#[0-9a-fA-F]{3,8}$' OR color_bl      IS NULL),
  color_am      text CHECK (color_am      ~ '^#[0-9a-fA-F]{3,8}$' OR color_am      IS NULL),
  color_rd      text CHECK (color_rd      ~ '^#[0-9a-fA-F]{3,8}$' OR color_rd      IS NULL),
  color_bg      text CHECK (color_bg      ~ '^#[0-9a-fA-F]{3,8}$' OR color_bg      IS NULL),
  color_d1      text CHECK (color_d1      ~ '^#[0-9a-fA-F]{3,8}$' OR color_d1      IS NULL),
  color_d2      text CHECK (color_d2      ~ '^#[0-9a-fA-F]{3,8}$' OR color_d2      IS NULL),
  color_d3      text CHECK (color_d3      ~ '^#[0-9a-fA-F]{3,8}$' OR color_d3      IS NULL),
  color_d4      text CHECK (color_d4      ~ '^#[0-9a-fA-F]{3,8}$' OR color_d4      IS NULL),

  -- ── Typography tokens ─────────────────────────────────────────────────────
  font_size_base text CHECK (font_size_base ~ '^[0-9]+(\.[0-9]+)?(px|rem|em)$' OR font_size_base IS NULL),
  font_size_xl   text CHECK (font_size_xl   ~ '^[0-9]+(\.[0-9]+)?(px|rem|em)$' OR font_size_xl   IS NULL),
  font_display   text,
  font_body      text,

  -- ── Geometry tokens ───────────────────────────────────────────────────────
  radius_lg      text CHECK (radius_lg   ~ '^[0-9]+(\.[0-9]+)?(px|rem|em|%)$' OR radius_lg   IS NULL),
  radius_full    text CHECK (radius_full ~ '^[0-9]+(\.[0-9]+)?(px|rem|em|%)$' OR radius_full IS NULL),

  -- ── Audit ─────────────────────────────────────────────────────────────────
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- One global row (company_id IS NULL) + one per company
  UNIQUE NULLS NOT DISTINCT (company_id)
);

ALTER TABLE design_system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON design_system_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
