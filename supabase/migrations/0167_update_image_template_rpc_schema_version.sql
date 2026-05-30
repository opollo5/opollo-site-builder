-- 0167: D2 — update_image_template() RPC to accept and store schema_version.
--
-- Design spec: docs/briefs/image-generator/v2-editor/MASS_IMAGE_GEN_EDITOR_v2_BUILD_BRIEF.md §D2
--
-- The D1 migration (0166) added the schema_version column with DEFAULT 1.
-- This migration replaces the update_image_template() RPC to:
--   1. Accept p_schema_version INTEGER DEFAULT 1 so callers can write v2 templates.
--   2. Propagate schema_version into both image_templates and image_template_versions.
--   3. Record the outgoing schema_version in history before the update (so the
--      version row shows which format was active before the change).
--
-- Backward-compatible: the new parameter has DEFAULT 1, so existing callers
-- (the TypeScript update_template() in lib/image/templates/index.ts) continue
-- to work unchanged until D4 updates them to pass schema_version explicitly.
--
-- CREATE OR REPLACE is safe to re-apply.

CREATE OR REPLACE FUNCTION update_image_template(
  p_template_id   UUID,
  p_updated_by    UUID,
  p_definition    JSONB,
  p_change_note   TEXT    DEFAULT NULL,
  p_schema_version INTEGER DEFAULT 1
) RETURNS image_templates AS $$
DECLARE
  v_template image_templates;
BEGIN
  SELECT * INTO v_template
  FROM image_templates
  WHERE id = p_template_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template % not found or not active', p_template_id;
  END IF;

  -- Record the outgoing state (with its schema_version) in version history.
  INSERT INTO image_template_versions(
    template_id, version, definition, schema_version, change_note, updated_by
  )
  VALUES (
    p_template_id,
    v_template.version,
    v_template.definition,
    v_template.schema_version,
    p_change_note,
    p_updated_by
  );

  -- Advance the template to the new definition and schema_version.
  UPDATE image_templates
  SET
    definition     = p_definition,
    schema_version = p_schema_version,
    version        = version + 1,
    updated_at     = NOW()
  WHERE id = p_template_id
  RETURNING * INTO v_template;

  RETURN v_template;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
