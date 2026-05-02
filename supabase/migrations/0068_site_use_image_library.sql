-- 0068 — Per-site "Use images from library" toggle.
-- Reference: DESIGN-SYSTEM-OVERHAUL workstream (PR 11/15).
--
-- When enabled, the brief runner pulls up to 5 captioned images from
-- image_library that match the page topic and passes them to the
-- generation prompt as suggestions. Default OFF — the operator opts
-- in only after confirming that the captioning + alt-text quality is
-- good enough for the site's content surfaces.
--
-- Pure ALTER TABLE ADD COLUMN with constant default. Existing rows
-- pick up the column metadata-only (no table rewrite, no backfill).

ALTER TABLE sites
  ADD COLUMN use_image_library boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sites.use_image_library IS
  'Per-site opt-in for inlining image_library suggestions into the generation system prompt. Default false. Toggled from /admin/sites/[id]/settings. Added 2026-05-02 (DESIGN-SYSTEM-OVERHAUL PR 11).';
