-- Migration 0098 — design_system_settings
-- Per-company (or global) design token overrides.
-- company_id IS NULL  → global defaults (singleton).
-- company_id = <uuid> → company-specific override (future use).

CREATE TABLE IF NOT EXISTS design_system_settings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        REFERENCES companies(id) ON DELETE CASCADE,

  -- Color tokens (hex strings, validated by CHECK)
  color_pk    text CHECK (color_pk  IS NULL OR color_pk  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_pk2   text CHECK (color_pk2 IS NULL OR color_pk2 ~ '^#[0-9a-fA-F]{3,8}$'),
  color_gr    text CHECK (color_gr  IS NULL OR color_gr  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_gr2   text CHECK (color_gr2 IS NULL OR color_gr2 ~ '^#[0-9a-fA-F]{3,8}$'),
  color_bl    text CHECK (color_bl  IS NULL OR color_bl  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_am    text CHECK (color_am  IS NULL OR color_am  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_rd    text CHECK (color_rd  IS NULL OR color_rd  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_d1    text CHECK (color_d1  IS NULL OR color_d1  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_d2    text CHECK (color_d2  IS NULL OR color_d2  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_d3    text CHECK (color_d3  IS NULL OR color_d3  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_d4    text CHECK (color_d4  IS NULL OR color_d4  ~ '^#[0-9a-fA-F]{3,8}$'),
  color_bg    text CHECK (color_bg  IS NULL OR color_bg  ~ '^#[0-9a-fA-F]{3,8}$'),

  -- Typography tokens
  font_display  text,
  font_body     text,

  -- Geometry tokens
  radius  text,

  -- Audit columns
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- One row per company (NULL = global)
  UNIQUE NULLS NOT DISTINCT (company_id)
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_design_system_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_design_system_settings_updated_at
  BEFORE UPDATE ON design_system_settings
  FOR EACH ROW EXECUTE FUNCTION update_design_system_settings_updated_at();

ALTER TABLE design_system_settings ENABLE ROW LEVEL SECURITY;

-- Service role has full access; admin UI reads/writes via service role client.
CREATE POLICY service_role_all ON design_system_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE design_system_settings IS
  'Per-company (or global) design token overrides applied at layout render time.';
