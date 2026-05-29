-- 0162: image_templates — per-company and global compositing templates.
--
-- Replaces the code-template constants in lib/image/compositing/templates-v1.ts
-- (A-NEW-1) with first-class database entities editable via the template editor
-- (A-NEW-3). Per §1.9 of MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md.
--
-- Global templates (company_id IS NULL) are owned by Opollo staff and seeded
-- below. Company-scoped templates override globals for the same name + ratio.
--
-- Versioning: image_template_versions stores the history. The update_image_template()
-- function is the only write path (mirrors update_brand_profile() pattern).

-- ─── image_templates ─────────────────────────────────────────────────────────

CREATE TABLE image_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        REFERENCES platform_companies(id) ON DELETE CASCADE, -- NULL = global
  name         TEXT        NOT NULL,
  aspect_ratio TEXT        NOT NULL,
  CONSTRAINT image_templates_aspect_ratio_check
    CHECK (aspect_ratio IN ('1x1','4x5','9x16','16x9','4x3')),
  -- definition: all fields consumed by sharp-renderer.ts
  -- { compositionType, overlayAlpha, logoPosition, logoSizePercent,
  --   logoPadding, maxHeadlineFontSize, fontFamily }
  definition   JSONB       NOT NULL,
  version      INT         NOT NULL DEFAULT 1,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_by   UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one active company-scoped template per (company, name, aspect_ratio).
CREATE UNIQUE INDEX idx_image_templates_company_active
  ON image_templates(company_id, name, aspect_ratio)
  WHERE is_active = true AND company_id IS NOT NULL;

-- Exactly one active global template per (name, aspect_ratio).
CREATE UNIQUE INDEX idx_image_templates_global_active
  ON image_templates(name, aspect_ratio)
  WHERE is_active = true AND company_id IS NULL;

-- Fast lookup: all active templates visible to a company (global + their own).
CREATE INDEX idx_image_templates_lookup
  ON image_templates(company_id, aspect_ratio, is_active);

-- ─── image_template_versions — version history ───────────────────────────────

CREATE TABLE image_template_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID        NOT NULL REFERENCES image_templates(id) ON DELETE CASCADE,
  version      INT         NOT NULL,
  definition   JSONB       NOT NULL,
  change_note  TEXT,
  updated_by   UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_image_template_versions_template
  ON image_template_versions(template_id, version DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE image_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_template_versions ENABLE ROW LEVEL SECURITY;

-- Templates: company members read their own + all global templates.
DROP POLICY IF EXISTS image_templates_read ON image_templates;
CREATE POLICY image_templates_read
  ON image_templates FOR SELECT
  TO authenticated
  USING (
    company_id IS NULL  -- global template
    OR EXISTS (
      SELECT 1 FROM platform_company_users pcu
      WHERE pcu.user_id   = auth.uid()
        AND pcu.company_id = image_templates.company_id
    )
  );

-- Company admins write company-scoped templates; Opollo staff write globals.
DROP POLICY IF EXISTS image_templates_write ON image_templates;
CREATE POLICY image_templates_write
  ON image_templates FOR ALL
  TO authenticated
  USING (
    (company_id IS NULL AND EXISTS (
      SELECT 1 FROM platform_users pu WHERE pu.id = auth.uid() AND pu.is_opollo_staff = true
    ))
    OR (company_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM platform_company_users pcu
      WHERE pcu.user_id   = auth.uid()
        AND pcu.company_id = image_templates.company_id
        AND pcu.role = 'admin'
    ))
  )
  WITH CHECK (
    (company_id IS NULL AND EXISTS (
      SELECT 1 FROM platform_users pu WHERE pu.id = auth.uid() AND pu.is_opollo_staff = true
    ))
    OR (company_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM platform_company_users pcu
      WHERE pcu.user_id   = auth.uid()
        AND pcu.company_id = image_templates.company_id
        AND pcu.role = 'admin'
    ))
  );

-- Versions: same read scope as templates.
DROP POLICY IF EXISTS image_template_versions_read ON image_template_versions;
CREATE POLICY image_template_versions_read
  ON image_template_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM image_templates t
      WHERE t.id = image_template_versions.template_id
        AND (t.company_id IS NULL OR EXISTS (
          SELECT 1 FROM platform_company_users pcu
          WHERE pcu.user_id = auth.uid() AND pcu.company_id = t.company_id
        ))
    )
  );

-- ─── update_image_template() RPC ─────────────────────────────────────────────
-- Updates a template's definition, increments version, records history.
-- Mirrors the update_brand_profile() pattern — never UPDATE directly.

CREATE OR REPLACE FUNCTION update_image_template(
  p_template_id UUID,
  p_updated_by  UUID,
  p_definition  JSONB,
  p_change_note TEXT DEFAULT NULL
) RETURNS image_templates AS $$
DECLARE
  v_template image_templates;
BEGIN
  SELECT * INTO v_template FROM image_templates WHERE id = p_template_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template % not found or not active', p_template_id;
  END IF;

  -- Record current state in version history.
  INSERT INTO image_template_versions(template_id, version, definition, change_note, updated_by)
  VALUES (p_template_id, v_template.version, v_template.definition, p_change_note, p_updated_by);

  -- Advance the template.
  UPDATE image_templates
  SET definition = p_definition,
      version    = version + 1,
      updated_at = NOW()
  WHERE id = p_template_id
  RETURNING * INTO v_template;

  RETURN v_template;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Seed: 5 default global templates ────────────────────────────────────────
-- Definition JSON matches lib/image/compositing/templates-v1.ts constants.
-- These become the fallback when a company has no custom template.

INSERT INTO image_templates (company_id, name, aspect_ratio, definition, version, is_active)
VALUES
  (NULL, 'default', '1x1', '{
    "compositionType": "split_layout",
    "overlayAlpha": 0.75,
    "logoPosition": "bottom-right",
    "logoSizePercent": 18,
    "logoPadding": 24,
    "maxHeadlineFontSize": 56,
    "fontFamily": "Inter"
  }', 1, true),

  (NULL, 'default', '4x5', '{
    "compositionType": "split_layout",
    "overlayAlpha": 0.75,
    "logoPosition": "bottom-right",
    "logoSizePercent": 16,
    "logoPadding": 24,
    "maxHeadlineFontSize": 52,
    "fontFamily": "Inter"
  }', 1, true),

  (NULL, 'default', '9x16', '{
    "compositionType": "full_background",
    "overlayAlpha": 0.82,
    "logoPosition": "bottom-left",
    "logoSizePercent": 14,
    "logoPadding": 28,
    "maxHeadlineFontSize": 48,
    "fontFamily": "Inter"
  }', 1, true),

  (NULL, 'default', '16x9', '{
    "compositionType": "gradient_fade",
    "overlayAlpha": 0.78,
    "logoPosition": "bottom-right",
    "logoSizePercent": 14,
    "logoPadding": 24,
    "maxHeadlineFontSize": 52,
    "fontFamily": "Inter"
  }', 1, true),

  (NULL, 'default', '4x3', '{
    "compositionType": "split_layout",
    "overlayAlpha": 0.75,
    "logoPosition": "bottom-right",
    "logoSizePercent": 16,
    "logoPadding": 24,
    "maxHeadlineFontSize": 48,
    "fontFamily": "Inter"
  }', 1, true)

ON CONFLICT DO NOTHING;
