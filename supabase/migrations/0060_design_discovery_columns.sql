-- 0060 — Design discovery columns on sites.
-- Reference: DESIGN-DISCOVERY workstream, PR 2/12. Setup wizard
-- /admin/sites/[id]/setup captures a design direction (Step 1) and a
-- tone of voice (Step 2), both feeding into existing generation
-- prompts (brief runner / M12 / M13 / BlogPostComposer) when the
-- DESIGN_CONTEXT_ENABLED feature flag is on.
--
-- This migration only adds the storage columns. The wizard itself,
-- the generation injection, and the feature flag are wired in later
-- PRs (3..12). All columns are nullable / default to a sentinel so
-- existing rows continue to work and the wizard's "skip for now"
-- and "in_progress" states can be represented without a backfill.
--
-- Design decisions encoded here:
--
-- 1. CHECK constraints over Postgres ENUM types for the two status
--    columns. Pattern: docs/patterns/new-migration.md "key shape
--    rules". An enum'd status would require a multi-step ALTER for
--    every future value; CHECK rewrites in one ALTER.
-- 2. JSONB for design_brief, design_tokens, tone_of_voice. The shapes
--    are still v1 — the spec calls out that tone/personality mapping
--    will need refinement with real usage data — and JSONB lets us
--    iterate the shape in app code without a schema change. Each
--    column is nullable because a "skipped" or "pending" site
--    legitimately has no captured value yet.
-- 3. Three separate text columns for the rendered HTML
--    (homepage_concept_html, inner_page_concept_html,
--    tone_applied_homepage_html) rather than collapsing them into
--    design_brief.json. The HTML can be megabytes per site once a
--    full concept lands; storing it inline in a JSONB blob makes
--    the row hot for every read of design_direction_status. Keeping
--    them as their own columns means a status-only SELECT doesn't
--    drag the HTML into memory.
-- 4. Status columns NOT NULL DEFAULT 'pending'. Existing sites
--    pre-discovery get 'pending' atomically as part of the ALTER —
--    no backfill needed. The wizard treats 'pending' as "show Step 1
--    fresh" and 'skipped' as "complete with defaults", so any older
--    site automatically lands at the start of the flow when an
--    operator first opens /admin/sites/[id]/setup.
-- 5. No new UNIQUE constraints. design_brief / tone_of_voice are
--    per-site and the existing sites.id PK already enforces that.
--
-- Write-safety notes:
--   - Pure ALTER TABLE ADD COLUMN. No locks beyond the brief metadata
--     update; no rewrite. Safe to run online.
--   - CHECK constraints applied at column creation (no ADD CONSTRAINT
--     pass) so there's no validation step over existing rows; default
--     values satisfy the constraint by construction.

ALTER TABLE sites
  ADD COLUMN design_brief jsonb NULL,
  ADD COLUMN homepage_concept_html text NULL,
  ADD COLUMN inner_page_concept_html text NULL,
  ADD COLUMN tone_applied_homepage_html text NULL,
  ADD COLUMN design_tokens jsonb NULL,
  ADD COLUMN design_direction_status text NOT NULL DEFAULT 'pending'
    CHECK (design_direction_status IN ('pending','in_progress','approved','skipped')),
  ADD COLUMN tone_of_voice jsonb NULL,
  ADD COLUMN tone_of_voice_status text NOT NULL DEFAULT 'pending'
    CHECK (tone_of_voice_status IN ('pending','in_progress','approved','skipped'));

COMMENT ON COLUMN sites.design_brief IS
  'JSONB capture of the operator''s design discovery inputs (reference URLs, screenshots metadata, text description, industry, refinement_notes[]). Nullable — set when the operator first runs the design direction step. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.homepage_concept_html IS
  'Rendered HTML for the approved homepage concept. Inline CSS only, no external deps. Used as reference context in downstream generation when DESIGN_CONTEXT_ENABLED. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.inner_page_concept_html IS
  'Rendered HTML for the approved inner-page concept (companion to homepage_concept_html). Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.tone_applied_homepage_html IS
  'Homepage concept HTML with the approved tone of voice rewritten into the hero / CTA / first service card. Generated post tone-approval; falls back to homepage_concept_html on failure. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.design_tokens IS
  'JSONB design tokens extracted from the approved concept: { primary, secondary, accent, background, text, font_heading, font_body, border_radius, spacing_unit }. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.design_direction_status IS
  'Wizard Step 1 status. ''pending'' (default) = not started, ''in_progress'' = inputs captured but no concept approved, ''approved'' = stored homepage_concept_html / inner_page_concept_html / design_tokens, ''skipped'' = operator skipped, generic MSP defaults applied. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.tone_of_voice IS
  'JSONB tone capture: { formality_level, sentence_length, jargon_usage, personality_markers[], avoid_markers[], target_audience, style_guide, approved_samples }. Injected as few-shot context into generation prompts when DESIGN_CONTEXT_ENABLED. Added 2026-04-30 (DESIGN-DISCOVERY).';

COMMENT ON COLUMN sites.tone_of_voice_status IS
  'Wizard Step 2 status. Same semantics as design_direction_status. Added 2026-04-30 (DESIGN-DISCOVERY).';
