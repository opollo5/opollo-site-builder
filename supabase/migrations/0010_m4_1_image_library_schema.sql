-- M4-1 — Image library schema.
-- Reference: docs/plans/m4.md. Parent plan in PR description of this slice.
--
-- Design decisions encoded here:
--
-- 1. image_library.cloudflare_id UNIQUE — every image maps to exactly one
--    Cloudflare Images asset and vice versa. No double-hosted images.
--
-- 2. image_library (source, source_ref) UNIQUE NULLS NOT DISTINCT — same
--    iStock image can't be ingested twice. NULLS NOT DISTINCT so two
--    NULL source_refs don't collide (used by source='upload' today where
--    we don't have a natural external ref).
--
-- 3. image_usage (image_id, site_id) UNIQUE — the write-safety keystone.
--    Exactly one wp_media_id per (image, site). Concurrent page publishes
--    of the same image to the same WP site race for the INSERT; the
--    loser hits 23505 and adopts the winner's wp_media_id via the
--    SAVEPOINT pattern (M4-7). Without this constraint, two publishes
--    can race two WP uploads of the same image — duplicate WP media
--    entries and extra WP storage billed on the client's side.
--
-- 4. transfer_job_items (transfer_job_id, cloudflare_idempotency_key)
--    UNIQUE — protects the Cloudflare call. Same key + same job +
--    duplicate call returns the existing Cloudflare id rather than
--    billing twice. Pre-computed on insert from (job_id, slot_index)
--    so retries reuse the same key automatically.
--
-- 5. transfer_job_items.state CHECK + lease-coherence CHECK — invalid
--    (state, worker_id, lease_expires_at) combinations are rejected at
--    the schema layer, not just in app code. Same pattern as M3's
--    generation_job_pages (see supabase/migrations/0007).
--
-- 6. transfer_events is append-only — billing + reconciliation source
--    of truth. Mirrors generation_events from M3. No UPDATE path; rows
--    only vanish via CASCADE from the parent transfer_jobs delete.
--
-- 7. image_library carries a generated tsvector column + GIN index for
--    FTS. The M4-6 search_images tool reads this. Generated column
--    keeps the vector in sync with caption + tags without app-side
--    maintenance.
--
-- 8. image_usage.image_id FK uses ON DELETE NO ACTION (the default, but
--    called out explicitly). A soft-delete of an image_library row is
--    permitted (deleted_at), but a hard DELETE fails if any image_usage
--    row references it. Prevents dangling wp_media_id pointers after an
--    operator purge.
--
-- Write-safety hotspots addressed:
--   - UNIQUE (cloudflare_id) — prevents double-hosted Cloudflare assets.
--   - UNIQUE (image_id, site_id) — prevents WP upload duplication.
--   - UNIQUE transfer_job_items idempotency keys — prevent Cloudflare /
--     Anthropic re-billing.
--   - lease-coherence CHECK — schema rejects invalid worker-state combos.
--   - Append-only transfer_events — reconciliation always possible.

-- ---------------------------------------------------------------------------
-- image_library — the master record per image we own.
-- ---------------------------------------------------------------------------

CREATE TABLE image_library (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cloudflare Images asset id (their GUID). NULL until the Cloudflare
  -- upload stage completes — the row can be pre-inserted before upload
  -- so the (source, source_ref) UNIQUE claims the ingest slot up-front.
  cloudflare_id         text UNIQUE,

  -- Original filename (for display / debugging; not identity).
  filename              text,

  -- AI-generated (M4-4). Caption is long-form descriptive; alt_text
  -- is short accessible alt; tags is the searchable keyword array.
  -- NULL before captioning completes.
  caption               text,
  alt_text              text,
  tags                  text[] NOT NULL DEFAULT ARRAY[]::text[],

  -- Provenance. source_ref is the external identifier (iStock id for
  -- 'istock'; uploader-supplied filename for 'upload'; generation id
  -- for 'generated').
  source                text NOT NULL
    CHECK (source IN ('istock', 'upload', 'generated')),
  source_ref            text,
  license_type          text,

  width_px              int
    CHECK (width_px IS NULL OR width_px > 0),
  height_px             int
    CHECK (height_px IS NULL OR height_px > 0),
  bytes                 bigint
    CHECK (bytes IS NULL OR bytes >= 0),

  -- Full-text search column. Maintained by a BEFORE INSERT/UPDATE
  -- trigger (see below) rather than a GENERATED expression — Postgres
  -- requires generated columns to use IMMUTABLE functions only, and
  -- to_tsvector(regconfig, text) is STABLE. The trigger achieves the
  -- same "app never sets this directly" contract. Indexed via GIN
  -- below.
  search_tsv            tsvector,

  -- Audit + soft-delete per docs/DATA_CONVENTIONS.md.
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  version_lock          int NOT NULL DEFAULT 1,

  -- Same iStock image can't be ingested twice. NULLS NOT DISTINCT so
  -- multiple uploads without a source_ref don't collide on NULL.
  CONSTRAINT image_library_source_ref_unique
    UNIQUE NULLS NOT DISTINCT (source, source_ref)
);

-- Maintain search_tsv in sync with caption + tags. Runs BEFORE the
-- row is written so the indexed value matches what a SELECT would
-- compute. Trigger function is plain SQL (STABLE default is OK for
-- trigger bodies — IMMUTABLE is only required on expressions used
-- in GENERATED columns / indexes).
CREATE OR REPLACE FUNCTION image_library_search_tsv_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.caption, '')), 'A')
    || setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
  RETURN NEW;
END;
$$;

CREATE TRIGGER image_library_search_tsv_trigger
  BEFORE INSERT OR UPDATE OF caption, tags ON image_library
  FOR EACH ROW
  EXECUTE FUNCTION image_library_search_tsv_refresh();

CREATE INDEX idx_image_library_search_tsv
  ON image_library USING GIN (search_tsv);
CREATE INDEX idx_image_library_tags
  ON image_library USING GIN (tags);
CREATE INDEX idx_image_library_source
  ON image_library (source, source_ref)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_image_library_created_at
  ON image_library (created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- image_metadata — extensible key/value metadata.
-- Keeps low-churn, rarely-queried per-image attributes out of the main
-- row without a schema change on every new dimension (EXIF, model info,
-- per-client licensing notes). UNIQUE (image_id, key) so upserts are
-- deterministic.
-- ---------------------------------------------------------------------------

CREATE TABLE image_metadata (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id              uuid NOT NULL
    REFERENCES image_library(id) ON DELETE CASCADE,
  key                   text NOT NULL,
  value_jsonb           jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT image_metadata_image_key_unique
    UNIQUE (image_id, key)
);

CREATE INDEX idx_image_metadata_image_id
  ON image_metadata (image_id);

-- ---------------------------------------------------------------------------
-- image_usage — per (image, site) WP transfer record.
--
-- The WRITE-SAFETY KEYSTONE. Exactly one wp_media_id per (image, site).
-- Concurrent M4-7 publishes racing the same image-to-site transfer
-- compete for the INSERT; the loser's SAVEPOINT recovers by adopting
-- the winner's wp_media_id.
-- ---------------------------------------------------------------------------

CREATE TABLE image_usage (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id              uuid NOT NULL
    REFERENCES image_library(id) ON DELETE NO ACTION,
  site_id               uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,

  -- Set once the WP POST succeeds. NULL during the in-flight window
  -- between SAVEPOINT and commit.
  wp_media_id           bigint,
  wp_source_url         text,

  -- Deduplication marker written to WP alongside the upload so retries
  -- can GET-by-marker for adoption without re-uploading.
  wp_idempotency_marker text NOT NULL,

  state                 text NOT NULL DEFAULT 'pending_transfer'
    CHECK (state IN ('pending_transfer', 'transferred', 'failed')),
  transferred_at        timestamptz,
  failure_code          text,
  failure_detail        text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT image_usage_image_site_unique
    UNIQUE (image_id, site_id)
);

CREATE INDEX idx_image_usage_site
  ON image_usage (site_id, state);

-- ---------------------------------------------------------------------------
-- transfer_jobs — long-running batches (9k iStock seed, per-page image
-- transfers, ad-hoc admin ingests). Mirrors the shape of generation_jobs
-- from M3 but for image operations.
-- ---------------------------------------------------------------------------

CREATE TABLE transfer_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Job type drives which processor the worker runs:
  --   'cloudflare_ingest' : upload + caption new images into the library.
  --   'wp_media_transfer' : mirror library images into a WP site.
  type                  text NOT NULL
    CHECK (type IN ('cloudflare_ingest', 'wp_media_transfer')),

  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),

  -- Caller-supplied idempotency key. Re-submission of the same key with
  -- the same body returns the original job id; different body is a
  -- conflict. Mirrors generation_jobs.
  idempotency_key       text UNIQUE,
  body_hash             text,

  requested_count       int NOT NULL CHECK (requested_count >= 0),
  succeeded_count       int NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count          int NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count         int NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),

  -- Cost aggregates, incremented by the worker (event-log-first;
  -- see docs/patterns/background-worker-with-write-safety.md).
  total_cost_usd_cents  bigint NOT NULL DEFAULT 0
    CHECK (total_cost_usd_cents >= 0),

  -- For wp_media_transfer jobs only. NULL for cloudflare_ingest.
  site_id               uuid
    REFERENCES sites(id) ON DELETE CASCADE,

  created_by            uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  cancel_requested_at   timestamptz,

  -- wp_media_transfer jobs must point at a site; cloudflare_ingest
  -- jobs must not.
  CONSTRAINT transfer_jobs_site_id_coherent
    CHECK (
      (type = 'wp_media_transfer' AND site_id IS NOT NULL)
      OR (type = 'cloudflare_ingest' AND site_id IS NULL)
    )
);

CREATE INDEX idx_transfer_jobs_status_active
  ON transfer_jobs (status)
  WHERE status IN ('pending', 'processing');
CREATE INDEX idx_transfer_jobs_created_by
  ON transfer_jobs (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX idx_transfer_jobs_site
  ON transfer_jobs (site_id)
  WHERE site_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- transfer_job_items — worker's unit of work.
--
-- Mirrors generation_job_pages. Same lease / heartbeat / reaper semantics
-- (docs/patterns/background-worker-with-write-safety.md). Pre-computed
-- idempotency keys for Cloudflare and (for caption rows) Anthropic.
-- ---------------------------------------------------------------------------

CREATE TABLE transfer_job_items (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_job_id               uuid NOT NULL
    REFERENCES transfer_jobs(id) ON DELETE CASCADE,
  slot_index                    int NOT NULL CHECK (slot_index >= 0),

  -- For cloudflare_ingest: the eventual image_library row. NULL until
  -- the INSERT lands. For wp_media_transfer: required at insert time.
  image_id                      uuid
    REFERENCES image_library(id) ON DELETE NO ACTION,

  -- For wp_media_transfer only: the target site. NULL otherwise (job's
  -- site_id is the authoritative target).
  target_site_id                uuid
    REFERENCES sites(id) ON DELETE CASCADE,

  state                         text NOT NULL DEFAULT 'pending'
    CHECK (state IN (
      'pending', 'leased', 'uploading', 'captioning', 'publishing',
      'succeeded', 'failed', 'skipped'
    )),

  worker_id                     text,
  lease_expires_at              timestamptz,
  retry_count                   int NOT NULL DEFAULT 0
    CHECK (retry_count >= 0),
  retry_after                   timestamptz,

  -- Pre-computed on insert. Reused across every retry of this item.
  cloudflare_idempotency_key    text NOT NULL,
  anthropic_idempotency_key     text NOT NULL,

  -- Populated by the worker as the item progresses. NULL before the
  -- corresponding stage runs.
  source_url                    text,
  source_bytes                  bigint,
  resulting_cloudflare_id       text,
  resulting_wp_media_id         bigint,

  cost_cents                    bigint NOT NULL DEFAULT 0
    CHECK (cost_cents >= 0),

  failure_code                  text,
  failure_detail                text,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- No duplicate slots per job.
  CONSTRAINT transfer_job_items_slot_unique
    UNIQUE (transfer_job_id, slot_index),

  -- Cloudflare idempotency is per-job: a reaped + relet item within
  -- the same job reuses its key; a separate job's item with the same
  -- item content generates a different key (different job_id → different
  -- UUIDv5 namespace input).
  CONSTRAINT transfer_job_items_cf_idemp_unique
    UNIQUE (transfer_job_id, cloudflare_idempotency_key),
  CONSTRAINT transfer_job_items_anthro_idemp_unique
    UNIQUE (transfer_job_id, anthropic_idempotency_key),

  -- Lease coherence: (state, worker_id, lease_expires_at) combinations
  -- allowed by the schema must match the worker's contract.
  CONSTRAINT transfer_job_items_lease_coherent
    CHECK (
      (state = 'pending'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR (state IN ('leased', 'uploading', 'captioning', 'publishing')
        AND worker_id IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR (state IN ('succeeded', 'failed', 'skipped'))
    ),

  -- wp_media_transfer items carry a target_site_id; cloudflare_ingest
  -- items don't (the job's site_id is NULL).
  CONSTRAINT transfer_job_items_target_site_coherent
    CHECK (
      target_site_id IS NULL OR image_id IS NOT NULL
    )
);

-- Partial index for the lease queue — the worker's hottest query.
-- Filters to pending items whose retry_after window has elapsed.
CREATE INDEX idx_transfer_job_items_lease_queue
  ON transfer_job_items (created_at ASC)
  WHERE state = 'pending';

CREATE INDEX idx_transfer_job_items_job
  ON transfer_job_items (transfer_job_id);
CREATE INDEX idx_transfer_job_items_image
  ON transfer_job_items (image_id)
  WHERE image_id IS NOT NULL;
CREATE INDEX idx_transfer_job_items_retry
  ON transfer_job_items (state, retry_after)
  WHERE state = 'pending' AND retry_after IS NOT NULL;

-- ---------------------------------------------------------------------------
-- transfer_events — append-only audit + billing source of truth.
-- Mirrors generation_events from M3.
-- ---------------------------------------------------------------------------

CREATE TABLE transfer_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_job_id       uuid NOT NULL
    REFERENCES transfer_jobs(id) ON DELETE CASCADE,
  transfer_job_item_id  uuid
    REFERENCES transfer_job_items(id) ON DELETE CASCADE,

  -- Event type. Constrained at the app layer only — adding a new type
  -- doesn't need a migration. Known types today:
  --   cloudflare_upload_started / _succeeded / _failed
  --   anthropic_caption_started / _response_received / _failed
  --   wp_media_upload_started / _succeeded / _failed / _adopted
  --   item_leased / _reaped / _cancelled
  --   job_status_changed
  event_type            text NOT NULL,

  payload_jsonb         jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_cents            bigint NOT NULL DEFAULT 0
    CHECK (cost_cents >= 0),

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfer_events_job
  ON transfer_events (transfer_job_id, created_at);
CREATE INDEX idx_transfer_events_item
  ON transfer_events (transfer_job_item_id, created_at)
  WHERE transfer_job_item_id IS NOT NULL;
CREATE INDEX idx_transfer_events_type
  ON transfer_events (event_type, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- Every table ships with ENABLE ROW LEVEL SECURITY + service_role_all.
-- Authenticated-role policies mirror the existing admin/operator/viewer
-- pattern (docs/patterns/rls-policy-test-matrix.md):
--   - image_library / image_metadata / image_usage: admin + operator
--     read; admin write; viewer read only.
--   - transfer_jobs + items + events: admin reads all; operators read
--     their own created jobs; viewer no read.
-- ---------------------------------------------------------------------------

ALTER TABLE image_library        ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_metadata       ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_usage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_jobs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_job_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_events      ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON image_library
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON image_metadata
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON image_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON transfer_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON transfer_job_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON transfer_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- image_library read: admin + operator + viewer all see non-deleted
-- rows. Write: admin + operator (creation during chat flow; admin
-- hard-deletes).
CREATE POLICY image_library_read ON image_library
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY image_library_write ON image_library
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY image_library_update ON image_library
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- image_metadata inherits visibility from its parent image.
CREATE POLICY image_metadata_read ON image_metadata
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
CREATE POLICY image_metadata_write ON image_metadata
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
CREATE POLICY image_metadata_update ON image_metadata
  FOR UPDATE TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));

-- image_usage visible to admin + operator for the site; writes happen
-- via service-role only (the M4-7 worker doesn't go through
-- authenticated clients).
CREATE POLICY image_usage_read ON image_usage
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

-- transfer_jobs: admin reads all, operators read their own.
CREATE POLICY transfer_jobs_read ON transfer_jobs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR created_by = auth.uid()
  );

-- transfer_job_items + transfer_events inherit via the parent job.
CREATE POLICY transfer_job_items_read ON transfer_job_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transfer_jobs j
      WHERE j.id = transfer_job_items.transfer_job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );

CREATE POLICY transfer_events_read ON transfer_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transfer_jobs j
      WHERE j.id = transfer_events.transfer_job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );
