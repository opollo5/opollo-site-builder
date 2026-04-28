-- 0028 — RS-2: site-level brand voice + design direction.
--
-- Today brand_voice and design_direction live exclusively on the
-- `briefs` row, so the operator re-types them every brief even though
-- the values almost never change between briefs of the same site. This
-- migration moves the *defaults* to the site row; the per-brief
-- columns stay (operator override still persists per brief).
--
-- Both columns are nullable. Existing sites get NULL and continue to
-- work — the brief-review form falls back to its current "no defaults"
-- behaviour when the site values are unset.
--
-- Forward-only. No backfill: operator sets the site-level value
-- explicitly via Site Settings.

ALTER TABLE sites
  ADD COLUMN brand_voice text,
  ADD COLUMN design_direction text;

COMMENT ON COLUMN sites.brand_voice IS
  'Site-level default brand voice copy. Inherited by new briefs as the brief-review default; per-brief brand_voice still overrides at commit time. Added 2026-04-27 (RS-2).';

COMMENT ON COLUMN sites.design_direction IS
  'Site-level default design direction copy. Inherited by new briefs as the brief-review default; per-brief design_direction still overrides at commit time. Added 2026-04-27 (RS-2).';
