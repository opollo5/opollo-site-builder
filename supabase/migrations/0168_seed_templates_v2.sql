-- 0168: D6 — bump global seed templates to schema_version=2 (layer-based).
--
-- Design spec: docs/briefs/image-generator/v2-editor/MASS_IMAGE_GEN_EDITOR_v2_BUILD_BRIEF.md §D6
--
-- Replaces the 5 global default templates (1x1, 4x5, 9x16, 16x9, 4x3) with
-- layer-based definitions that reproduce the same visual layout as the old
-- fixed-zone format, but in the Template/Layer schema understood by the v2
-- renderer (compositeLayerBased → renderTemplate).
--
-- Layer stack per template (top-first = rendered on top):
--   1. headline  — TextLayer   — modifiable API field for the generated caption
--   2. overlay   — RectangleLayer — dark semi-transparent band behind the text
--   3. logo      — ImageLayer  — brand logo, hide_when_empty
--   4. background— ImageLayer  — full-canvas AI image, hide_when_empty
--
-- Guard: only updates rows still at schema_version=1 (idempotent).
-- Uses a direct UPDATE rather than the RPC to avoid needing a real updatedBy UUID.
-- The version history entry is written manually for audit trail completeness.
--
-- Pixel coordinates derived from TEXT_ZONE_MAP percentages:
--   split_layout    → x=58%, y=15%, w=37%, h=70%
--   gradient_fade   → x=5%,  y=15%, w=37%, h=70%
--   full_background → x=5%,  y=68%, w=90%, h=24%
-- Logo size: logoSizePercent% × min(canvasW, canvasH)
-- Logo position (bottom-right): x = W - size - padding, y = H - size - padding

-- ─── Helper: record history before update ────────────────────────────────────

CREATE OR REPLACE FUNCTION _d6_record_and_update(
  p_aspect_ratio   TEXT,
  p_new_definition JSONB
) RETURNS VOID AS $$
DECLARE
  v_tmpl image_templates;
BEGIN
  SELECT * INTO v_tmpl
  FROM image_templates
  WHERE company_id IS NULL
    AND name = 'default'
    AND aspect_ratio = p_aspect_ratio
    AND is_active = true
    AND schema_version = 1;

  IF NOT FOUND THEN RETURN; END IF; -- already upgraded or doesn't exist

  -- Record outgoing state in version history.
  INSERT INTO image_template_versions(
    template_id, version, definition, schema_version, change_note, updated_by
  ) VALUES (
    v_tmpl.id, v_tmpl.version, v_tmpl.definition, v_tmpl.schema_version,
    'D6: upgrade to schema_version=2 layer-based format',
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  -- Advance the template.
  UPDATE image_templates
  SET
    definition     = p_new_definition,
    schema_version = 2,
    version        = v_tmpl.version + 1,
    updated_at     = NOW()
  WHERE id = v_tmpl.id;
END;
$$ LANGUAGE plpgsql;

-- ─── 16x9 (1280×720, gradient_fade) ──────────────────────────────────────────
-- Text zone: x=64, y=108, w=474, h=504  (5%, 15%, 37%, 70% of 1280×720)
-- Logo: bottom-right, size=101px (14%×720), padding=24 → x=1155, y=595

SELECT _d6_record_and_update('16x9', $json$
{
  "id": "seed-16x9",
  "version": 2,
  "name": "Default 16:9",
  "width": 1280,
  "height": 720,
  "orientation": "landscape",
  "background_color": "#0F172A",
  "layers": [
    {
      "id": "seed-16x9-headline",
      "name": "headline",
      "type": "text",
      "x": 64, "y": 108, "width": 474, "height": 504,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left", "vertical": "top" },
      "text": "", "font_family": "Inter", "font_size": 52, "font_weight": 700,
      "color": "#FFFFFF",
      "text_align_h": "left", "text_align_v": "center",
      "letter_spacing": -1, "line_height": 1.15,
      "text_transform": "none", "text_decoration": "none",
      "word_break": "normal", "style": "", "direction": "ltr",
      "text_fit": { "enabled": true, "min_size": 24, "max_size": 52, "max_lines": 5 },
      "truncate": false,
      "text_box": { "padding": null, "border": null },
      "background": { "color": null, "border": null, "border_width": null,
        "padding_h": 0, "padding_v": 0, "shadow": null, "radius": null, "shift": null },
      "secondary": { "font_family": null, "color": null },
      "var": { "label": "Headline Text", "required": true, "default": "",
        "category": "content", "help": "Main caption for this post image" }
    },
    {
      "id": "seed-16x9-overlay",
      "name": "overlay",
      "type": "rectangle",
      "x": 64, "y": 108, "width": 474, "height": 504,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 0.78,
      "locked": true, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left", "vertical": "top" },
      "color": "#000000", "gradient": null, "border_radius": 0, "border": null
    },
    {
      "id": "seed-16x9-logo",
      "name": "logo",
      "type": "image",
      "x": 1155, "y": 595, "width": 101, "height": 101,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": true, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "bottom" },
      "asset_id": null, "image_url": null,
      "fill": "fit", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Logo", "required": false, "default": "",
        "category": "branding", "help": "Brand logo (optional)" }
    },
    {
      "id": "seed-16x9-background",
      "name": "background",
      "type": "image",
      "x": 0, "y": 0, "width": 1280, "height": 720,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": true, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "top_bottom" },
      "asset_id": null, "image_url": null,
      "fill": "cover", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Background Image", "required": false, "default": "",
        "category": "media", "help": "AI-generated background image" }
    }
  ],
  "groups": [], "fonts": [], "variants": [],
  "render_settings": { "format": "png", "quality": 100, "scale": 1, "dpi": 72 },
  "settings": { "guides": true }
}
$json$::jsonb);

-- ─── 1x1 (1080×1080, split_layout) ───────────────────────────────────────────
-- Text zone: x=626, y=162, w=400, h=756  (58%, 15%, 37%, 70% of 1080×1080)
-- Logo: bottom-right, size=151px (14%×1080), padding=24 → x=905, y=905

SELECT _d6_record_and_update('1x1', $json$
{
  "id": "seed-1x1",
  "version": 2,
  "name": "Default 1:1",
  "width": 1080,
  "height": 1080,
  "orientation": "square",
  "background_color": "#0F172A",
  "layers": [
    {
      "id": "seed-1x1-headline",
      "name": "headline",
      "type": "text",
      "x": 626, "y": 162, "width": 400, "height": 756,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "text": "", "font_family": "Inter", "font_size": 56, "font_weight": 700,
      "color": "#FFFFFF",
      "text_align_h": "left", "text_align_v": "center",
      "letter_spacing": -1, "line_height": 1.15,
      "text_transform": "none", "text_decoration": "none",
      "word_break": "normal", "style": "", "direction": "ltr",
      "text_fit": { "enabled": true, "min_size": 24, "max_size": 56, "max_lines": 6 },
      "truncate": false,
      "text_box": { "padding": null, "border": null },
      "background": { "color": null, "border": null, "border_width": null,
        "padding_h": 0, "padding_v": 0, "shadow": null, "radius": null, "shift": null },
      "secondary": { "font_family": null, "color": null },
      "var": { "label": "Headline Text", "required": true, "default": "",
        "category": "content", "help": "Main caption for this post image" }
    },
    {
      "id": "seed-1x1-overlay",
      "name": "overlay",
      "type": "rectangle",
      "x": 626, "y": 162, "width": 400, "height": 756,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 0.75,
      "locked": true, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "color": "#000000", "gradient": null, "border_radius": 0, "border": null
    },
    {
      "id": "seed-1x1-logo",
      "name": "logo",
      "type": "image",
      "x": 905, "y": 905, "width": 151, "height": 151,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": true, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "bottom" },
      "asset_id": null, "image_url": null,
      "fill": "fit", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Logo", "required": false, "default": "",
        "category": "branding", "help": "Brand logo (optional)" }
    },
    {
      "id": "seed-1x1-background",
      "name": "background",
      "type": "image",
      "x": 0, "y": 0, "width": 1080, "height": 1080,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": true, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "top_bottom" },
      "asset_id": null, "image_url": null,
      "fill": "cover", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Background Image", "required": false, "default": "",
        "category": "media", "help": "AI-generated background image" }
    }
  ],
  "groups": [], "fonts": [], "variants": [],
  "render_settings": { "format": "png", "quality": 100, "scale": 1, "dpi": 72 },
  "settings": { "guides": true }
}
$json$::jsonb);

-- ─── 4x5 (1080×1350, split_layout) ───────────────────────────────────────────
-- Text zone: x=626, y=203, w=400, h=945  (58%, 15%, 37%, 70% of 1080×1350)
-- Logo: bottom-right, size=151px (14%×1080), padding=24 → x=905, y=1175

SELECT _d6_record_and_update('4x5', $json$
{
  "id": "seed-4x5",
  "version": 2,
  "name": "Default 4:5",
  "width": 1080,
  "height": 1350,
  "orientation": "portrait",
  "background_color": "#0F172A",
  "layers": [
    {
      "id": "seed-4x5-headline",
      "name": "headline",
      "type": "text",
      "x": 626, "y": 203, "width": 400, "height": 945,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "text": "", "font_family": "Inter", "font_size": 52, "font_weight": 700,
      "color": "#FFFFFF",
      "text_align_h": "left", "text_align_v": "center",
      "letter_spacing": -1, "line_height": 1.15,
      "text_transform": "none", "text_decoration": "none",
      "word_break": "normal", "style": "", "direction": "ltr",
      "text_fit": { "enabled": true, "min_size": 24, "max_size": 52, "max_lines": 8 },
      "truncate": false,
      "text_box": { "padding": null, "border": null },
      "background": { "color": null, "border": null, "border_width": null,
        "padding_h": 0, "padding_v": 0, "shadow": null, "radius": null, "shift": null },
      "secondary": { "font_family": null, "color": null },
      "var": { "label": "Headline Text", "required": true, "default": "",
        "category": "content", "help": "Main caption for this post image" }
    },
    {
      "id": "seed-4x5-overlay",
      "name": "overlay",
      "type": "rectangle",
      "x": 626, "y": 203, "width": 400, "height": 945,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 0.75,
      "locked": true, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "color": "#000000", "gradient": null, "border_radius": 0, "border": null
    },
    {
      "id": "seed-4x5-logo",
      "name": "logo",
      "type": "image",
      "x": 905, "y": 1175, "width": 151, "height": 151,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": true, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "bottom" },
      "asset_id": null, "image_url": null,
      "fill": "fit", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Logo", "required": false, "default": "",
        "category": "branding", "help": "Brand logo (optional)" }
    },
    {
      "id": "seed-4x5-background",
      "name": "background",
      "type": "image",
      "x": 0, "y": 0, "width": 1080, "height": 1350,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": true, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "top_bottom" },
      "asset_id": null, "image_url": null,
      "fill": "cover", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Background Image", "required": false, "default": "",
        "category": "media", "help": "AI-generated background image" }
    }
  ],
  "groups": [], "fonts": [], "variants": [],
  "render_settings": { "format": "png", "quality": 100, "scale": 1, "dpi": 72 },
  "settings": { "guides": true }
}
$json$::jsonb);

-- ─── 9x16 (1080×1920, full_background) ───────────────────────────────────────
-- Text zone: x=54, y=1306, w=972, h=461  (5%, 68%, 90%, 24% of 1080×1920)
-- Logo: bottom-left, size=151px (14%×1080), padding=28 → x=28, y=1741

SELECT _d6_record_and_update('9x16', $json$
{
  "id": "seed-9x16",
  "version": 2,
  "name": "Default 9:16",
  "width": 1080,
  "height": 1920,
  "orientation": "portrait",
  "background_color": "#0F172A",
  "layers": [
    {
      "id": "seed-9x16-headline",
      "name": "headline",
      "type": "text",
      "x": 54, "y": 1306, "width": 972, "height": 461,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "bottom" },
      "text": "", "font_family": "Inter", "font_size": 48, "font_weight": 700,
      "color": "#FFFFFF",
      "text_align_h": "center", "text_align_v": "center",
      "letter_spacing": -1, "line_height": 1.15,
      "text_transform": "none", "text_decoration": "none",
      "word_break": "normal", "style": "", "direction": "ltr",
      "text_fit": { "enabled": true, "min_size": 24, "max_size": 48, "max_lines": 4 },
      "truncate": false,
      "text_box": { "padding": null, "border": null },
      "background": { "color": null, "border": null, "border_width": null,
        "padding_h": 0, "padding_v": 0, "shadow": null, "radius": null, "shift": null },
      "secondary": { "font_family": null, "color": null },
      "var": { "label": "Headline Text", "required": true, "default": "",
        "category": "content", "help": "Main caption for this post image" }
    },
    {
      "id": "seed-9x16-overlay",
      "name": "overlay",
      "type": "rectangle",
      "x": 54, "y": 1306, "width": 972, "height": 461,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 0.82,
      "locked": true, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "bottom" },
      "color": "#000000", "gradient": null, "border_radius": 0, "border": null
    },
    {
      "id": "seed-9x16-logo",
      "name": "logo",
      "type": "image",
      "x": 28, "y": 1741, "width": 151, "height": 151,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": true, "description": "", "group": null,
      "constraints": { "horizontal": "left", "vertical": "bottom" },
      "asset_id": null, "image_url": null,
      "fill": "fit", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Logo", "required": false, "default": "",
        "category": "branding", "help": "Brand logo (optional)" }
    },
    {
      "id": "seed-9x16-background",
      "name": "background",
      "type": "image",
      "x": 0, "y": 0, "width": 1080, "height": 1920,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": true, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "top_bottom" },
      "asset_id": null, "image_url": null,
      "fill": "cover", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Background Image", "required": false, "default": "",
        "category": "media", "help": "AI-generated background image" }
    }
  ],
  "groups": [], "fonts": [], "variants": [],
  "render_settings": { "format": "png", "quality": 100, "scale": 1, "dpi": 72 },
  "settings": { "guides": true }
}
$json$::jsonb);

-- ─── 4x3 (1280×960, split_layout) ────────────────────────────────────────────
-- Text zone: x=742, y=144, w=474, h=672  (58%, 15%, 37%, 70% of 1280×960)
-- Logo: bottom-right, size=154px (16%×960), padding=24 → x=1102, y=782

SELECT _d6_record_and_update('4x3', $json$
{
  "id": "seed-4x3",
  "version": 2,
  "name": "Default 4:3",
  "width": 1280,
  "height": 960,
  "orientation": "landscape",
  "background_color": "#0F172A",
  "layers": [
    {
      "id": "seed-4x3-headline",
      "name": "headline",
      "type": "text",
      "x": 742, "y": 144, "width": 474, "height": 672,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "text": "", "font_family": "Inter", "font_size": 48, "font_weight": 700,
      "color": "#FFFFFF",
      "text_align_h": "left", "text_align_v": "center",
      "letter_spacing": -1, "line_height": 1.15,
      "text_transform": "none", "text_decoration": "none",
      "word_break": "normal", "style": "", "direction": "ltr",
      "text_fit": { "enabled": true, "min_size": 24, "max_size": 48, "max_lines": 6 },
      "truncate": false,
      "text_box": { "padding": null, "border": null },
      "background": { "color": null, "border": null, "border_width": null,
        "padding_h": 0, "padding_v": 0, "shadow": null, "radius": null, "shift": null },
      "secondary": { "font_family": null, "color": null },
      "var": { "label": "Headline Text", "required": true, "default": "",
        "category": "content", "help": "Main caption for this post image" }
    },
    {
      "id": "seed-4x3-overlay",
      "name": "overlay",
      "type": "rectangle",
      "x": 742, "y": 144, "width": 474, "height": 672,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 0.75,
      "locked": true, "hide": false, "hide_when_empty": false,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "top" },
      "color": "#000000", "gradient": null, "border_radius": 0, "border": null
    },
    {
      "id": "seed-4x3-logo",
      "name": "logo",
      "type": "image",
      "x": 1102, "y": 782, "width": 154, "height": 154,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": false, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": true, "description": "", "group": null,
      "constraints": { "horizontal": "right", "vertical": "bottom" },
      "asset_id": null, "image_url": null,
      "fill": "fit", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Logo", "required": false, "default": "",
        "category": "branding", "help": "Brand logo (optional)" }
    },
    {
      "id": "seed-4x3-background",
      "name": "background",
      "type": "image",
      "x": 0, "y": 0, "width": 1280, "height": 960,
      "rotation": 0, "rotate_x": 0, "rotate_y": 0, "rotate_z": 0,
      "skew_x": 0, "skew_y": 0, "opacity": 1,
      "locked": true, "hide": false, "hide_when_empty": true,
      "lock_aspect_ratio": false, "description": "", "group": null,
      "constraints": { "horizontal": "left_right", "vertical": "top_bottom" },
      "asset_id": null, "image_url": null,
      "fill": "cover", "anchor_x": "center", "anchor_y": "center",
      "tint_color": null, "border_radius": 0, "clip_path": null, "face_detect": false,
      "var": { "label": "Background Image", "required": false, "default": "",
        "category": "media", "help": "AI-generated background image" }
    }
  ],
  "groups": [], "fonts": [], "variants": [],
  "render_settings": { "format": "png", "quality": 100, "scale": 1, "dpi": 72 },
  "settings": { "guides": true }
}
$json$::jsonb);

-- ─── Cleanup helper function ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS _d6_record_and_update(TEXT, JSONB);
