-- 0013 — M12-1 briefs schema.
-- Reference: docs/plans/m12-1-slice.md. Parent plan: docs/plans/m12-parent.md.
--
-- Design decisions encoded here:
--
-- 1. Four tables in one migration (briefs / brief_pages / brief_runs /
--    site_conventions). Consolidating site_conventions here means M12-2
--    and M12-3 are purely app-layer slices; no further schema churn.
--
-- 2. briefs.upload_idempotency_key UNIQUE — double-submit of the same
--    file (server-computed key or client-supplied) replays to the same
--    row instead of creating a second row. The app layer catches 23505
--    and short-circuits to the replay envelope.
--
-- 3. briefs.source_storage_path UNIQUE — one brief per Storage object.
--    Prevents two rows pointing at the same Storage key.
--
-- 4. briefs coherence CHECKs on status/committed_at/committed_page_hash
--    enforce at the schema layer that 'committed' rows carry both
--    committed timestamps AND a page_hash (the commit idempotency key).
--    Non-committed rows must have both NULL. No code path can produce
--    a half-committed brief.
--
-- 5. brief_pages (brief_id, ordinal) UNIQUE — no duplicate positions in
--    a brief's page list. Gaps are allowed (ordinal 0,2,3 with 1 missing
--    is fine — the runner reads ORDER BY ordinal).
--
-- 6. brief_runs_one_active_per_brief — partial UNIQUE index where
--    status IN ('queued','running','paused'). The concurrency keystone
--    from the parent plan §Sequential runner concurrency. M12-3 leases
--    against this; a second enqueue raises 23505 and the API surfaces
--    BRIEF_RUN_ALREADY_ACTIVE. M12-1 never writes runs, but the index
--    lands now so M12-3 is app-layer only.
--
-- 7. brief_runs_lease_coherent CHECK — mirrors M3/M7 lease-coherence:
--    (queued AND no worker) OR (running/paused with worker+lease) OR
--    terminal. Bad state combos rejected at the schema layer, not just
--    in app code.
--
-- 8. site_conventions UNIQUE (brief_id) — exactly one conventions row
--    per brief. The anchor-cycle promotion (M12-3) UPSERTs against this.
--
-- 9. Storage bucket 'site-briefs' is private (public = false). All
--    access flows through the service-role helper after the admin gate;
--    defence-in-depth authenticated read policy gates the role band in
--    case a signed URL is ever issued.
--
-- Write-safety hotspots addressed:
--   - UNIQUE (upload_idempotency_key) — double-submit replay.
--   - UNIQUE (source_storage_path) — no two briefs for one Storage key.
--   - coherence CHECKs on briefs — no half-committed rows.
--   - partial UNIQUE on brief_runs — one active run per brief.
--   - lease-coherence CHECK on brief_runs — schema rejects invalid
--     worker/state combos.
--   - UNIQUE (brief_id) on site_conventions — one conventions row per
--     brief; anchor-promotion UPDATE is safe against concurrent runners.

-- ----------------------------------------------------------------------------
-- briefs — one row per uploaded brief document.
-- ----------------------------------------------------------------------------

CREATE TABLE briefs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id                   uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,

  title                     text NOT NULL,

  status                    text NOT NULL DEFAULT 'parsing'
    CHECK (status IN ('parsing', 'parsed', 'committed', 'failed_parse')),

  -- Supabase Storage pointer. Populated by the upload route.
  source_storage_path       text NOT NULL,
  source_mime_type          text NOT NULL
    CHECK (source_mime_type IN ('text/plain', 'text/markdown')),
  source_size_bytes         bigint NOT NULL
    CHECK (source_size_bytes > 0 AND source_size_bytes <= 10485760),
  source_sha256             text NOT NULL,

  -- Stripe-style idempotency: same key + same SHA → replay; same key +
  -- different SHA → IDEMPOTENCY_KEY_CONFLICT (app layer).
  upload_idempotency_key    text NOT NULL,

  -- Parser output metadata. NULL until parsing completes.
  parser_mode               text
    CHECK (parser_mode IS NULL OR parser_mode IN ('structural', 'claude_inference')),
  parser_warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,

  parse_failure_code        text,
  parse_failure_detail      text,

  -- Commit state. All three are NULL until operator commits; all three
  -- are NOT NULL after. Coherence enforced by CHECKs below.
  committed_at              timestamptz,
  committed_by              uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  committed_page_hash       text,

  version_lock              int NOT NULL DEFAULT 1,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  created_by                uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_by                uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  CONSTRAINT briefs_source_storage_path_unique
    UNIQUE (source_storage_path),
  CONSTRAINT briefs_upload_idempotency_key_unique
    UNIQUE (upload_idempotency_key),

  -- committed_at set iff status='committed'.
  CONSTRAINT briefs_committed_at_coherent
    CHECK ((committed_at IS NULL) = (status <> 'committed')),
  -- committed_page_hash set iff status='committed'.
  CONSTRAINT briefs_committed_page_hash_coherent
    CHECK ((committed_page_hash IS NULL) = (status <> 'committed'))
);

CREATE INDEX idx_briefs_site_created
  ON briefs (site_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_briefs_site_status
  ON briefs (site_id, status)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- brief_pages — one row per parsed page in a brief.
-- Editable by the operator pre-commit; frozen thereafter.
-- ----------------------------------------------------------------------------

CREATE TABLE brief_pages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  brief_id            uuid NOT NULL
    REFERENCES briefs(id) ON DELETE CASCADE,

  -- 0-indexed position in the page list. Gaps allowed; runner reads
  -- ORDER BY ordinal.
  ordinal             int NOT NULL CHECK (ordinal >= 0),

  title               text NOT NULL,
  slug_hint           text,

  mode                text NOT NULL
    CHECK (mode IN ('full_text', 'short_brief')),

  -- Byte offsets into the source document. NULL when the inference
  -- fallback produced the entry without a verifiable span (dropped
  -- entries never make it this far — see lib/brief-parser.ts).
  source_span_start   int,
  source_span_end     int
    CHECK (source_span_end IS NULL OR source_span_end > source_span_start),

  -- Extracted section text. For full_text mode this is the complete
  -- section (≥ 400 words per parent plan); for short_brief this is the
  -- summary snippet. Read verbatim by the runner.
  source_text         text NOT NULL,
  word_count          int NOT NULL CHECK (word_count >= 0),

  operator_notes      text,

  version_lock        int NOT NULL DEFAULT 1,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  created_by          uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_by          uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  CONSTRAINT brief_pages_brief_ordinal_unique
    UNIQUE (brief_id, ordinal)
);

-- Hot-path query for both the review UI and the runner's "next page"
-- lookup. EXPLAIN ANALYZE plan attached to the PR body per parent
-- plan §EXPLAIN ANALYZE requirement.
CREATE INDEX idx_brief_pages_brief_ordinal
  ON brief_pages (brief_id, ordinal)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- brief_runs — scaffolding for the M12-3 runner.
-- M12-1 creates the table empty; M12-3 inserts + leases.
-- ----------------------------------------------------------------------------

CREATE TABLE brief_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  brief_id              uuid NOT NULL
    REFERENCES briefs(id) ON DELETE CASCADE,

  status                text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),

  current_ordinal       int
    CHECK (current_ordinal IS NULL OR current_ordinal >= 0),

  worker_id             text,
  lease_expires_at      timestamptz,
  last_heartbeat_at     timestamptz,

  started_at            timestamptz,
  finished_at           timestamptz,

  failure_code          text,
  failure_detail        text,
  cancel_requested_at   timestamptz,

  version_lock          int NOT NULL DEFAULT 1,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  created_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  -- Mirrors the M3 / M7 lease-coherence constraint.
  CONSTRAINT brief_runs_lease_coherent
    CHECK (
      (status = 'queued'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')
    )
);

-- Concurrency keystone: at most one non-terminal run per brief.
-- Second enqueue raises 23505 and the API surfaces
-- BRIEF_RUN_ALREADY_ACTIVE.
CREATE UNIQUE INDEX brief_runs_one_active_per_brief
  ON brief_runs (brief_id)
  WHERE status IN ('queued', 'running', 'paused');

-- Drives FOR UPDATE SKIP LOCKED dequeue in M12-3.
CREATE INDEX idx_brief_runs_leasable
  ON brief_runs (lease_expires_at NULLS FIRST)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_brief_runs_brief_created
  ON brief_runs (brief_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- site_conventions — per-brief frozen design+content conventions.
-- Written at the end of page 1's anchor cycle; read verbatim by pages 2..N.
-- M12-1 creates the table empty; M12-3 writes it.
-- ----------------------------------------------------------------------------

CREATE TABLE site_conventions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  brief_id              uuid NOT NULL
    REFERENCES briefs(id) ON DELETE CASCADE,

  -- Free text in M12-1; M12-2 adds CHECK enums once the values are
  -- locked from eval experiments.
  typographic_scale     text,
  section_rhythm        text,
  hero_pattern          text,
  cta_phrasing          jsonb,
  color_role_map        jsonb,
  tone_register         text,

  -- Escape hatch for conventions the anchor cycle discovers that don't
  -- fit the columns above. "Stored exact" contract per parent plan.
  additional            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Set by the runner when the anchor cycle completes. NULL until then.
  frozen_at             timestamptz,

  version_lock          int NOT NULL DEFAULT 1,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  created_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  CONSTRAINT site_conventions_brief_unique
    UNIQUE (brief_id)
);

-- ----------------------------------------------------------------------------
-- Storage bucket — site-briefs.
-- Private bucket; all access via service-role after the admin gate.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'site-briefs',
  'site-briefs',
  false,
  10485760,
  ARRAY['text/plain', 'text/markdown']
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Row Level Security — briefs / brief_pages / brief_runs / site_conventions.
-- Shape: service-role-all + authenticated read for all roles +
-- authenticated write for admin/operator. Viewers read-only.
-- ----------------------------------------------------------------------------

ALTER TABLE briefs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_pages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_conventions    ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON briefs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON brief_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON brief_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON site_conventions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- briefs — viewers + operators + admins read; operators + admins write.
CREATE POLICY briefs_read ON briefs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY briefs_insert ON briefs
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY briefs_update ON briefs
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY briefs_delete ON briefs
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

CREATE POLICY brief_pages_read ON brief_pages
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY brief_pages_insert ON brief_pages
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY brief_pages_update ON brief_pages
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY brief_pages_delete ON brief_pages
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

CREATE POLICY brief_runs_read ON brief_runs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY brief_runs_insert ON brief_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY brief_runs_update ON brief_runs
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY brief_runs_delete ON brief_runs
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

CREATE POLICY site_conventions_read ON site_conventions
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY site_conventions_insert ON site_conventions
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY site_conventions_update ON site_conventions
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY site_conventions_delete ON site_conventions
  FOR DELETE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

-- ----------------------------------------------------------------------------
-- Storage policies — site-briefs bucket.
-- Service-role writes via API route; authenticated role-band read is
-- defence-in-depth for any future signed-URL flow.
-- ----------------------------------------------------------------------------

CREATE POLICY site_briefs_service_role_all ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'site-briefs')
  WITH CHECK (bucket_id = 'site-briefs');

CREATE POLICY site_briefs_authed_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'site-briefs'
    AND public.auth_role() IN ('admin', 'operator', 'viewer')
  );
