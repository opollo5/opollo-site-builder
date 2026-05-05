-- DATA_CONVENTIONS rollout: add created_by + updated_by to sites.
-- Both nullable (no historical attribution for existing rows).
-- FK to opollo_users with ON DELETE SET NULL so user deletion doesn't
-- orphan site rows.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES opollo_users(id) ON DELETE SET NULL;
