-- 0044 — Optimiser: opt_client_memory.
-- Reference: spec §11.1 (per-client memory), §9.10.2 (design feedback),
-- §5.1.
--
-- Per-client learning surface. Three feedback patterns stored, all
-- keyed by (client_id, memory_type, key). UNIQUE on the triple keeps
-- the row count bounded — repeat rejections of the same playbook +
-- page type combination bump the count rather than insert a new row.
--
-- Suppression rule (§11.1 + §11.1 Table 26): three rejections with
-- the SAME reason for the same playbook + page type combination
-- suppresses the playbook for that client. "bad timing" is excluded
-- from suppression counting. Slice 6 enforces this in code; the
-- memory layer just stores the raw counts.

CREATE TABLE opt_client_memory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  -- 'rejected_pattern' — playbook+pageType+reason rejection counts
  -- 'winning_variant'  — Phase 2 A/B winners
  -- 'preference'       — design feedback (component / tone / density)
  memory_type         text NOT NULL
    CHECK (memory_type IN ('rejected_pattern', 'winning_variant', 'preference')),

  -- Compact lookup key, structure depends on memory_type:
  --   rejected_pattern: '<playbook_id>:<page_type>:<reason_code>'
  --   winning_variant:  '<playbook_id>:<page_type>'
  --   preference:       'component:<id>' / 'tone:<id>' / 'density:<id>'
  key                 text NOT NULL,

  -- Free-form payload. For rejected_pattern: { count, last_rejected_at }.
  -- For preference: { observation, override_applied, evidence }.
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- count is mirrored out of payload so the UI can sort by it without
  -- a JSONB cast. Kept consistent by the memory-update helper in
  -- lib/optimiser.
  count               integer NOT NULL DEFAULT 0
    CHECK (count >= 0),

  -- TRUE if a staff member explicitly cleared / disabled the entry.
  -- Suppression logic ignores cleared rows.
  cleared             boolean NOT NULL DEFAULT false,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX opt_client_memory_uniq
  ON opt_client_memory (client_id, memory_type, key);

CREATE INDEX opt_client_memory_client_type_idx
  ON opt_client_memory (client_id, memory_type)
  WHERE cleared = false;

ALTER TABLE opt_client_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_client_memory
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_client_memory_read ON opt_client_memory
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_client_memory_write ON opt_client_memory
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
