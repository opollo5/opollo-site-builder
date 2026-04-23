-- 0015 — M15 schema defense-in-depth: version_lock CHECK constraints.
--
-- Five tables were shipped with `version_lock int NOT NULL DEFAULT 1` but
-- without the `CHECK (version_lock >= 1)` constraint their siblings carry
-- (design_systems, design_components, design_templates, pages,
-- tenant_cost_budgets). Surfaced by the M15-2 schema audit (finding #9).
--
-- Why it matters: an off-by-one bug in an optimistic-lock bump that wrote
-- version_lock = 0 would be silently accepted on the 5 tables without
-- this CHECK and rejected on the 5 with it. The constraint is defense-in-
-- depth against that asymmetry.
--
-- Safe to add: the app never writes version_lock < 1 deliberately. Any
-- existing row already satisfies the predicate (schema default is 1,
-- all writes increment monotonically).

ALTER TABLE image_library
  ADD CONSTRAINT image_library_version_lock_positive
  CHECK (version_lock >= 1);

ALTER TABLE briefs
  ADD CONSTRAINT briefs_version_lock_positive
  CHECK (version_lock >= 1);

ALTER TABLE brief_pages
  ADD CONSTRAINT brief_pages_version_lock_positive
  CHECK (version_lock >= 1);

ALTER TABLE brief_runs
  ADD CONSTRAINT brief_runs_version_lock_positive
  CHECK (version_lock >= 1);

ALTER TABLE site_conventions
  ADD CONSTRAINT site_conventions_version_lock_positive
  CHECK (version_lock >= 1);
