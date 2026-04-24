-- Rollback for 0017.
-- Drops brand_voice + design_direction from briefs.
--
-- Data loss: any values operators have typed into these fields between
-- this migration's forward apply and the rollback are LOST. Run this
-- rollback only on an environment where the data is not needed — e.g.
-- a forward-migration bug required the rollback before the schema ever
-- accumulated real operator input.

ALTER TABLE briefs
  DROP COLUMN IF EXISTS brand_voice,
  DROP COLUMN IF EXISTS design_direction;
