-- 0017 — M12-2 brand_voice + design_direction on briefs.
-- Reference: docs/plans/m12-parent.md §Scope M12-2.
--
-- M12-2 adds two first-class fields to `briefs`:
--
--   - brand_voice        — free text describing the voice/tone the runner
--                          should use across every generated page.
--   - design_direction   — free text describing the design direction the
--                          anchor cycle should resolve into site_conventions.
--
-- Both are nullable because:
--
--   1. The operator fills them on the review page between parse and commit.
--      Leaving them nullable lets M12-1's existing upload+parse path land
--      rows (status='parsing'/'parsed') before the operator has a chance to
--      fill them.
--
--   2. A future M12-3 enhancement will seed defaults via a Claude-inferred
--      pass during parse. When that lands, null remains the "operator did
--      not override and Claude did not infer" sentinel; the runner can
--      decide whether to proceed or fail ANCHOR_FAILED based on other
--      context.
--
-- No CHECK constraints. These are descriptive prose, not enumerated values.
-- Empty string is accepted as a distinct signal from NULL ("operator
-- acknowledged the field but left it blank") but neither the schema nor
-- the runner treats empty string differently from NULL today.
--
-- No index. Neither column is queried as a filter; both are read by
-- pointed PK lookup on the brief row.
--
-- No backfill. Rows written under 0013 remain (NULL, NULL) — M12-1 had
-- no concept of brand_voice/design_direction, and leaving existing rows
-- unchanged matches what the operator saw at upload time. The review
-- surface in M12-2 shows empty textareas for such rows and the operator
-- fills them before committing, same as for newly-uploaded briefs.

ALTER TABLE briefs
  ADD COLUMN brand_voice text,
  ADD COLUMN design_direction text;

COMMENT ON COLUMN briefs.brand_voice IS
  'Operator-authored voice/tone guidance for the runner. Nullable; empty string distinct from NULL is allowed but not treated differently today. Populated on the review page before commit (M12-2); may later be seeded by Claude inference at parse time (M12-3).';

COMMENT ON COLUMN briefs.design_direction IS
  'Operator-authored design direction guidance that feeds the anchor cycle (M12-3) when resolving site_conventions. Nullable; same treatment as brand_voice.';
