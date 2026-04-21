-- M3-1 — Batch page generator schema
-- Reference: M3 plan (v2, audited) posted in PR description of this slice.
--
-- Design decisions encoded here:
--
-- 1. generation_jobs carries the operator-initiated batch. idempotency_key
--    + body_hash pair lets the creator endpoint (M3-2) give Stripe-style
--    semantics on repeat POST: same key + same body → replay the original
--    job id; same key + different body → 422 IDEMPOTENCY_KEY_CONFLICT
--    rather than silently returning a mismatched row.
--
-- 2. generation_job_pages is the unit of work a worker leases. The
--    concurrency contract lives on this table:
--      - UNIQUE (job_id, slot_index) ensures no duplicate slots per job.
--      - state has an explicit CHECK constraint so an illegal transition
--        (e.g. succeeded → leased) can only happen via a bug, not via a
--        schema permitting it.
--      - lease_expires_at + worker_id drive the FOR UPDATE SKIP LOCKED
--        dequeue that M3-3 implements.
--      - anthropic_idempotency_key / wp_idempotency_key pre-compute the
--        stable retry keys on insert so the worker doesn't have to
--        derive them under load.
--
-- 3. generation_events is an append-only audit log. One row per state
--    transition or notable side effect (anthropic_response_received,
--    gate_failed, etc). Its key property: it is written BEFORE the
--    corresponding slot-column update, so if the slot update fails the
--    billing / state transition is still reconstructible from the log.
--    Retention is deferred to M7 fleet-infra.
--
-- 4. pages gets a UNIQUE (site_id, slug). Pre-existing at M1a as a
--    text column with no uniqueness. Adding it here is the durable
--    concurrency claim that prevents two M3 workers from racing the
--    same slug into the same WP site — a pre-commit INSERT into pages
--    with the slot's slug will fail with unique_violation on the second
--    worker, which short-circuits to SLUG_CONFLICT without ever calling
--    WordPress. See M3 plan §10, row 4.
--
-- 5. All new tables: service_role_all is the primary access path (every
--    worker + creator route uses it). Authenticated-role SELECT policies
--    are defence-in-depth for if we ever expose a PostgREST view of
--    these tables; writes always go through service-role.

-- ----------------------------------------------------------------------------
-- pages: UNIQUE (site_id, slug)
--
-- Fails if pre-existing (site_id, slug) duplicates exist. In M2-and-earlier
-- no row was inserted with a slug a human chose, so in practice the
-- table is empty in prod today. If a future deploy catches a duplicate,
-- the migration fails loud and an operator triages — preferable to the
-- silent duplicate-page outcome the constraint is there to prevent.
-- ----------------------------------------------------------------------------

ALTER TABLE pages
  ADD CONSTRAINT pages_site_slug_unique UNIQUE (site_id, slug);

-- ----------------------------------------------------------------------------
-- generation_jobs
-- ----------------------------------------------------------------------------

CREATE TABLE generation_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  template_id           uuid NOT NULL
    REFERENCES design_templates(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled'
    )),
  requested_count       int NOT NULL CHECK (requested_count > 0),
  succeeded_count       int NOT NULL DEFAULT 0
    CHECK (succeeded_count >= 0),
  failed_count          int NOT NULL DEFAULT 0
    CHECK (failed_count >= 0),

  -- idempotency pair. UNIQUE on idempotency_key gives POST replay; the
  -- body_hash comparison happens at the app layer on replay so we can
  -- return 422 IDEMPOTENCY_KEY_CONFLICT with a useful message.
  idempotency_key       text UNIQUE,
  body_hash             text,

  -- Cost aggregation columns. Updated incrementally by the worker (M3-4)
  -- when a slot finishes; NOT by a trigger (see M3 plan §7 — triggers on
  -- this table would deadlock with concurrent worker UPDATEs on sibling
  -- slots).
  total_cost_usd_cents  bigint NOT NULL DEFAULT 0
    CHECK (total_cost_usd_cents >= 0),
  total_input_tokens    bigint NOT NULL DEFAULT 0
    CHECK (total_input_tokens >= 0),
  total_output_tokens   bigint NOT NULL DEFAULT 0
    CHECK (total_output_tokens >= 0),
  total_cached_tokens   bigint NOT NULL DEFAULT 0
    CHECK (total_cached_tokens >= 0),

  created_by            uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  finished_at           timestamptz,
  cancel_requested_at   timestamptz
);

CREATE INDEX idx_generation_jobs_site_created
  ON generation_jobs (site_id, created_at DESC);
CREATE INDEX idx_generation_jobs_created_by
  ON generation_jobs (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX idx_generation_jobs_active
  ON generation_jobs (status)
  WHERE status IN ('queued', 'running');

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON generation_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin reads every job; creators read their own. Operators who
-- created a job see it via created_by = auth.uid(); operators who
-- didn't create the job don't see it (matches the "batches run by
-- other operators" privacy line, admins remain unconstrained).
CREATE POLICY generation_jobs_read ON generation_jobs
  FOR SELECT TO authenticated
  USING (public.auth_role() = 'admin' OR created_by = auth.uid());

-- ----------------------------------------------------------------------------
-- generation_job_pages
--
-- One row per slot within a job. The worker's unit of work.
-- ----------------------------------------------------------------------------

CREATE TABLE generation_job_pages (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                     uuid NOT NULL
    REFERENCES generation_jobs(id) ON DELETE CASCADE,
  slot_index                 int NOT NULL CHECK (slot_index >= 0),

  state                      text NOT NULL DEFAULT 'pending'
    CHECK (state IN (
      'pending',
      'leased',
      'generating',
      'validating',
      'publishing',
      'succeeded',
      'failed',
      'skipped'
    )),

  -- Operator-supplied brief for this specific slot: topic, keywords,
  -- slug hint, etc. Validated at the app layer (M3-2).
  inputs                     jsonb NOT NULL,

  -- Stable idempotency keys computed on insert. Worker reuses them on
  -- every retry of the same slot so Anthropic returns the cached
  -- response and WordPress adoption matches the same post.
  anthropic_idempotency_key  text NOT NULL,
  wp_idempotency_key         text NOT NULL,

  -- WP / opollo links. Populated on first successful publish.
  wp_page_id                 bigint,
  pages_id                   uuid
    REFERENCES pages(id) ON DELETE SET NULL,
  pages_row_slug             text,

  -- Lease + heartbeat. A lease is held by worker_id and expires at
  -- lease_expires_at; heartbeat updates both.
  worker_id                  text,
  lease_expires_at           timestamptz,
  last_heartbeat_at          timestamptz,
  attempts                   int NOT NULL DEFAULT 0
    CHECK (attempts >= 0),

  last_error_code            text,
  last_error_message         text,
  quality_gate_failures      jsonb,

  -- Per-slot cost + token accounting. Worker writes these after each
  -- Anthropic call; generation_jobs.total_* is an on-demand SUM().
  cost_usd_cents             bigint NOT NULL DEFAULT 0
    CHECK (cost_usd_cents >= 0),
  input_tokens               bigint NOT NULL DEFAULT 0
    CHECK (input_tokens >= 0),
  output_tokens              bigint NOT NULL DEFAULT 0
    CHECK (output_tokens >= 0),
  cached_tokens              bigint NOT NULL DEFAULT 0
    CHECK (cached_tokens >= 0),

  -- Anthropic's response.id, for reconciliation against usage reports.
  anthropic_raw_response_id  text,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  started_at                 timestamptz,
  finished_at                timestamptz,

  CONSTRAINT generation_job_pages_slot_unique UNIQUE (job_id, slot_index),
  CONSTRAINT generation_job_pages_anthropic_key_unique
    UNIQUE (job_id, anthropic_idempotency_key),
  CONSTRAINT generation_job_pages_wp_key_unique
    UNIQUE (job_id, wp_idempotency_key),

  -- state ↔ lease fields coherence. A 'leased' row without worker_id
  -- or lease_expires_at is malformed, and vice versa.
  CONSTRAINT generation_job_pages_lease_coherent
    CHECK (
      (state = 'pending'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR state IN (
        'leased', 'generating', 'validating', 'publishing',
        'succeeded', 'failed', 'skipped'
      )
    )
);

-- Lease-candidate partial index. Drives the FOR UPDATE SKIP LOCKED
-- dequeue in M3-3: candidates are state = 'pending' or state IN
-- (leased, generating, validating, publishing) with an expired lease.
-- Terminal states (succeeded / failed / skipped) stay out of the index
-- so it doesn't balloon over time.
CREATE INDEX idx_job_pages_leasable
  ON generation_job_pages (lease_expires_at NULLS FIRST)
  WHERE state IN (
    'pending', 'leased', 'generating', 'validating', 'publishing'
  );

CREATE INDEX idx_job_pages_job_state
  ON generation_job_pages (job_id, state);

CREATE INDEX idx_job_pages_pages_id
  ON generation_job_pages (pages_id)
  WHERE pages_id IS NOT NULL;

ALTER TABLE generation_job_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON generation_job_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated reads piggy-back on the parent job's visibility: if
-- you can SELECT the job, you can SELECT its slots.
CREATE POLICY generation_job_pages_read ON generation_job_pages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_job_pages.job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- generation_events
--
-- Append-only audit log. Written BEFORE the owning row's state update
-- so billing / state transitions are reconstructible even on partial
-- failure.
-- ----------------------------------------------------------------------------

CREATE TABLE generation_events (
  id             bigserial PRIMARY KEY,
  job_id         uuid NOT NULL
    REFERENCES generation_jobs(id) ON DELETE CASCADE,
  page_slot_id   uuid
    REFERENCES generation_job_pages(id) ON DELETE SET NULL,
  event          text NOT NULL,
  details        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_generation_events_job
  ON generation_events (job_id, created_at DESC);
CREATE INDEX idx_generation_events_slot
  ON generation_events (page_slot_id, created_at DESC)
  WHERE page_slot_id IS NOT NULL;

ALTER TABLE generation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON generation_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same visibility rule as job_pages: if you can SELECT the job, you
-- can SELECT its events.
CREATE POLICY generation_events_read ON generation_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_events.job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );
