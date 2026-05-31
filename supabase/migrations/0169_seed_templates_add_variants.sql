-- 0169: add Square (1080×1080) + Landscape (1200×630) variants to the
-- 5 global seed templates.
--
-- Multi-format brief: docs/briefs/image-generator/v2-editor/MULTI_FORMAT_BRIEF.md
--
-- The variant model (Template.variants) already exists in the JSONB definition.
-- This migration populates it so the editor's format switcher has tabs to show.
--
-- Reflow semantics: the variant sizes trigger applyVariant() in the editor which
-- uses each layer's constraint pins to reposition/resize. The constraint pins
-- were set in migration 0168 (D6) per the seed template design.
--
-- Guard: only updates templates that don't already have variants populated.
-- Safe to re-run; UPDATE is idempotent for rows that already have variants.

UPDATE image_templates
SET definition = jsonb_set(
  definition,
  '{variants}',
  '[
    {
      "key": "square",
      "width": 1080,
      "height": 1080,
      "overrides": []
    },
    {
      "key": "landscape",
      "width": 1200,
      "height": 630,
      "overrides": []
    }
  ]'::jsonb
),
updated_at = NOW()
WHERE company_id IS NULL
  AND is_active = true
  AND schema_version = 2
  AND (definition->'variants' = '[]'::jsonb OR definition->'variants' IS NULL);
