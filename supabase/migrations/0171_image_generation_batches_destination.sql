-- Migration 0171: Add destination column to image_generation_batches
--
-- D5 (IMAGE_TO_POST_FULL_BUILD_BRIEF §2): operators choose Download vs Publish
-- before generating. The choice is persisted on the batch so the approval
-- carousel (Slice G) and download endpoint (Slice E) can behave accordingly.
--
-- Discovery: image_generation_batches owns the batch lifecycle and is already
-- joined to per-job rows — the correct table per D5 discovery rule.
--
-- Values:
--   'publish'  (DEFAULT) — existing behaviour; approval auto-creates a draft
--   'download' — approval adds to a download set; no draft created
--
-- Online-safe: ADD COLUMN with a NOT NULL DEFAULT acquires no row-level lock.
-- Existing batches get DEFAULT 'publish' (backwards-compatible).

ALTER TABLE image_generation_batches
  ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL DEFAULT 'publish'
    CONSTRAINT image_generation_batches_destination_check
      CHECK (destination IN ('download', 'publish'));

COMMENT ON COLUMN image_generation_batches.destination IS
  'Operator-chosen output path: ''publish'' creates social drafts on approval '
  '(default, backwards-compatible); ''download'' adds assets to a download set.';
