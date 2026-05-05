-- 0066 — Design discovery server-side regeneration caps.
-- Reference: DESIGN-DISCOVERY-FOLLOWUP PR 3.
--
-- Today the 10-call cap on concept refinements + tone-sample
-- regenerations lives client-side only. Refresh the page or hit the
-- API directly and the cap is silently bypassed; that drives both
-- cost (every refinement is a paid Anthropic call) and quality
-- (operators rotate through prompts indefinitely instead of accepting
-- a result).
--
-- Move enforcement to the server. Add a regeneration_counts JSONB
-- column to sites with two named buckets, increment from the API
-- handlers, return 429 when a bucket >= 10. The "Reset and start over"
-- CTAs zero the relevant bucket.
--
-- Design decisions encoded here:
--
-- 1. Single JSONB column over two int columns. The shape is likely to
--    grow (Phase 2 spec mentions style-token regenerations + per-page
--    re-runs); JSONB lets the schema iterate without column churn.
-- 2. NOT NULL DEFAULT '{"concept_refinements":0,"tone_samples":0}'. No
--    backfill needed — every existing row gets the default atomically
--    as part of the ALTER. The application reads the bucket via
--    COALESCE so unknown buckets default to 0 (forward-compatible).
-- 3. CHECK ((regeneration_counts->>'concept_refinements')::int >= 0
--    AND (regeneration_counts->>'tone_samples')::int >= 0). Schema-level
--    guard against an app bug writing a negative count and silently
--    re-enabling refinements; the cap is enforced in app code at
--    < 10, so the schema only needs the floor.
-- 4. No UNIQUE / FK changes. Counts are per-site and the existing
--    sites.id PK already enforces that.
--
-- Write-safety notes:
--   - Pure ALTER TABLE ADD COLUMN with a constant DEFAULT. No table
--     rewrite (Postgres 11+); existing rows pick up the default
--     metadata-only.
--   - CHECK constraint applied at column creation; the default value
--     satisfies it by construction so there's no validation pass over
--     existing rows.

ALTER TABLE sites
  ADD COLUMN regeneration_counts jsonb NOT NULL
    DEFAULT '{"concept_refinements":0,"tone_samples":0}'::jsonb
    CHECK (
      COALESCE((regeneration_counts->>'concept_refinements')::int, 0) >= 0
      AND COALESCE((regeneration_counts->>'tone_samples')::int, 0) >= 0
    );

COMMENT ON COLUMN sites.regeneration_counts IS
  'Server-enforced cap state for the setup wizard. Buckets: concept_refinements (Step 1 refinement loop, capped at 10) and tone_samples (Step 2 sample regeneration loop, capped at 10). Reset to 0 on the relevant Reset CTA. Added 2026-05-01 (DESIGN-DISCOVERY-FOLLOWUP).';
