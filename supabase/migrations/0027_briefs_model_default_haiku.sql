-- 0027 — Default brief model to Haiku 4.5.
--
-- Reference: UAT-smoke-1 BACKLOG entry "Default model selection —
-- currently Sonnet 4.6, should be Haiku 4.5 for dev/test (deferred
-- from UAT smoke 1, 2026-04-28)".
--
-- Migration 0020 set briefs.text_model + briefs.visual_model column
-- defaults to 'claude-sonnet-4-6'. UAT smoke 1 surfaced the cost: at
-- ~5× Haiku rates, every dev / UAT / sanity-check run ate Sonnet
-- money for output the operator didn't need at that quality tier.
-- Defaults flipped to Haiku — operators opt UP to Sonnet/Opus per-
-- brief on the review surface.
--
-- Behaviour-preserving: existing rows are not touched. Column default
-- only applies on INSERT when the field is omitted (the upload path
-- doesn't set it; commit-time selection always sets it explicitly via
-- the review-screen picker). The CHECK constraint on the allowed
-- values stays the same — Haiku has been in the allowlist since
-- migration 0020 shipped.

ALTER TABLE briefs
  ALTER COLUMN text_model SET DEFAULT 'claude-haiku-4-5-20251001',
  ALTER COLUMN visual_model SET DEFAULT 'claude-haiku-4-5-20251001';

COMMENT ON COLUMN briefs.text_model IS
  'Anthropic model used for the text pass loop (draft / self_critique / revise / visual_revise). Default Haiku 4.5 (cheap-by-default for dev/UAT). Operator opts up to Sonnet/Opus per-brief on the review surface. CHECK constraint pins the allowed set; lib/anthropic-pricing.ts has rates.';
COMMENT ON COLUMN briefs.visual_model IS
  'Anthropic model used for the multi-modal visual critique pass. Default Haiku 4.5. Sonnet usually enough for production briefs; Opus reserved for complex-judgment briefs.';
