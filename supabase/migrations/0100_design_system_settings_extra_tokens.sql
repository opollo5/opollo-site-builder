-- 0100 — Extend design_system_settings with font-size and radius-variant columns.
--
-- Migration 0098 added the initial colour + font-family + generic radius columns.
-- This migration adds:
--   • font_size_base / font_size_xl  — typographic scale overrides
--   • radius_lg / radius_full        — replaces the generic "radius" column with
--                                      two named variants (base card + pill button)
--
-- The old "radius" column is left in place for now; get-override.ts reads
-- radius_lg/radius_full when set and falls back gracefully when they are null.
-- A follow-up slice can drop "radius" once it is confirmed unused in prod.

BEGIN;

ALTER TABLE design_system_settings
  ADD COLUMN IF NOT EXISTS font_size_base text
    CHECK (font_size_base ~ '^[0-9]+(\.[0-9]+)?(px|rem|em)$' OR font_size_base IS NULL),
  ADD COLUMN IF NOT EXISTS font_size_xl   text
    CHECK (font_size_xl   ~ '^[0-9]+(\.[0-9]+)?(px|rem|em)$' OR font_size_xl   IS NULL),
  ADD COLUMN IF NOT EXISTS radius_lg      text
    CHECK (radius_lg      ~ '^[0-9]+(\.[0-9]+)?(px|rem|em|%)$' OR radius_lg    IS NULL),
  ADD COLUMN IF NOT EXISTS radius_full    text
    CHECK (radius_full    ~ '^[0-9]+(\.[0-9]+)?(px|rem|em|%)$' OR radius_full  IS NULL);

COMMIT;
