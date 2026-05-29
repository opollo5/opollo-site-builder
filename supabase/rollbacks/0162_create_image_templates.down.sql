-- Rollback for 0162. Only safe when both tables are empty.
DROP FUNCTION IF EXISTS update_image_template;
DROP POLICY IF EXISTS image_template_versions_read ON image_template_versions;
DROP POLICY IF EXISTS image_templates_write ON image_templates;
DROP POLICY IF EXISTS image_templates_read ON image_templates;
DROP TABLE IF EXISTS image_template_versions;
DROP TABLE IF EXISTS image_templates;
