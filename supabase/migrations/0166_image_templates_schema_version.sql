-- 0166: D1 — add schema_version to image_templates (v2 editor programme).
--
-- Design spec: docs/briefs/image-generator/v2-editor/MASS_IMAGE_GEN_EDITOR_v2_BUILD_BRIEF.md §D1
--
-- Schema version discriminates between the two template definition formats:
--   1 = fixed-zone format (A-NEW-3 / compositeSharp() path)
--   2 = layer-based format (v2 editor / compositeLayerBased() path)
--
-- ADD COLUMN ... DEFAULT is instant on Postgres 11+ (no table rewrite, no
-- data scan). All existing rows receive schema_version=1, which correctly
-- identifies them as the legacy fixed-zone format requiring no migration.
--
-- image_template_versions also gains the column so the version-history audit
-- trail records which schema was in effect at each write.

ALTER TABLE image_templates
  ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE image_template_versions
  ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

-- Fast path: the E8 compositeImage() dispatcher reads schema_version to route
-- to compositeLayerBased() vs compositeSharp(). Index speeds that lookup.
CREATE INDEX IF NOT EXISTS idx_image_templates_schema_version
  ON image_templates(schema_version)
  WHERE is_active = true;

COMMENT ON COLUMN image_templates.schema_version IS
  '1=fixed-zone (A-NEW-3), 2=layer-based (v2 editor). Drives compositeImage() dispatch.';

COMMENT ON COLUMN image_template_versions.schema_version IS
  'Schema version at the time this history row was written.';
