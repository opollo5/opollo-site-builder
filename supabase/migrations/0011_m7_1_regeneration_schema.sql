-- M7-1 — Single-page re-generation schema.
-- Reference: docs/plans/m7-parent.md. Write-safety-critical milestone;
-- the full risks audit is in the parent plan + this slice's PR.
--
-- Design decisions encoded here:
--
-- 1. regeneration_jobs carries the operator-initiated single-page
--    re-run. Shape mirrors generation_jobs (M3-1) but is always
--    single-slot — no separate child-slot table because re-gen is
--    always one page at a time.
--
-- 2. (page_id) UNIQUE WHERE status IN ('pending', 'running') is the
--    concurrency-limit keystone: at most one in-flight regen per
--    page. A second enqueue attempt catches 23505 and surfaces
--    REGEN_ALREADY_IN_FLIGHT in the API response. Prevents two
--    concurrent regens from racing two Anthropic calls + two WP
--    PUTs on the same page.
--
-- 3. anthropic_idempotency_key + wp_idempotency_key UNIQUE per job
--    so a reaped + relet job keeps its retry keys. Mirrors M3-1's
--    generation_job_pages design.
--
-- 4. expected_page_version is snapshotted at enqueue time from the
--    current pages.version_lock. The worker's final UPDATE to `pages`
--    pins version_lock = expected; a metadata edit mid-regen (M6-3
--    path) bumps the lock and the regen's commit fails with
--    VERSION_CONFLICT. Operator retries; the new job snapshots the
--    new version.
--
-- 5. Lease-coherence CHECK mirrors M3's generation_job_pages and
--    M4's transfer_job_items: (state, worker_id, lease_expires_at)
--    must be consistent. A 'leased' row without worker_id is
--    malformed at the schema level.
--
-- 6. regeneration_events is append-only. Every billed external call
--    produces an event row BEFORE the corresponding state-column
--    flip. Billing reconciliation + post-mortem debugging both read
--    the event log. Same posture as M3's generation_events and M4's
--    transfer_events.
--
-- 7. ON DELETE CASCADE from sites + pages: when a site or page is
--    removed, in-flight regen jobs go with them. Completed jobs are
--    not audit-critical (the pages table holds the committed result);
--    re-evaluate if an auditor ever asks for "who regen'd what when"
--    across deleted pages.
--
-- Write-safety hotspots addressed here:
--   - partial UNIQUE on page_id + active-status filter.
--   - anthropic_idempotency_key + wp_idempotency_key UNIQUE per job.
--   - lease-coherence CHECK.
--   - Append-only regeneration_events.

-- ---------------------------------------------------------------------------
-- regeneration_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE regeneration_jobs (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                    uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,
  page_id                    uuid NOT NULL
    REFERENCES pages(id) ON DELETE CASCADE,

  -- State machine. Terminal states: succeeded, failed, failed_gates,
  -- cancelled. failed_gates is called out separately from failed so the
  -- UI can render "quality gates rejected the new HTML" with the
  -- gate-failure payload, distinct from "Anthropic or WP blew up".
  status                     text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'running',
      'succeeded',
      'failed',
      'failed_gates',
      'cancelled'
    )),

  -- Snapshot of pages.version_lock at enqueue time. Worker's final
  -- UPDATE to `pages` pins version_lock = expected; a mid-regen
  -- metadata edit (M6-3 path) bumps the lock and the commit fails
  -- with VERSION_CONFLICT. See parent plan risk 4.
  expected_page_version      int NOT NULL CHECK (expected_page_version >= 1),

  -- Pre-computed stable retry keys. Insert-time only; never overwritten.
  anthropic_idempotency_key  text NOT NULL,
  wp_idempotency_key         text NOT NULL,

  -- Lease + heartbeat. Same contract as M3's generation_job_pages.
  worker_id                  text,
  lease_expires_at           timestamptz,
  last_heartbeat_at          timestamptz,
  attempts                   int NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  retry_after                timestamptz,

  -- Cost + token accounting. Worker writes these after the Anthropic
  -- response arrives and BEFORE the status flip.
  cost_usd_cents             bigint NOT NULL DEFAULT 0
    CHECK (cost_usd_cents >= 0),
  input_tokens               bigint NOT NULL DEFAULT 0
    CHECK (input_tokens >= 0),
  output_tokens              bigint NOT NULL DEFAULT 0
    CHECK (output_tokens >= 0),
  cached_tokens              bigint NOT NULL DEFAULT 0
    CHECK (cached_tokens >= 0),

  -- Anthropic's response.id, for reconciliation against their usage
  -- reports. Mirrors generation_job_pages.anthropic_raw_response_id.
  anthropic_raw_response_id  text,

  -- Quality-gate failures payload when status = 'failed_gates'.
  quality_gate_failures      jsonb,

  -- Terminal failure detail. Structured enough for the UI to render
  -- "Anthropic rate-limited — retry later" or "WP credentials
  -- missing" without grepping logs.
  failure_code               text,
  failure_detail             text,

  created_by                 uuid
    REFERENCES opollo_users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  started_at                 timestamptz,
  finished_at                timestamptz,
  cancel_requested_at        timestamptz,

  -- Idempotency keys are per-job. Two different regen jobs with the
  -- same key would be a bug (UUIDv5 is pre-computed from job_id +
  -- namespace constants); the schema catches it.
  CONSTRAINT regeneration_jobs_anthropic_key_unique
    UNIQUE (id, anthropic_idempotency_key),
  CONSTRAINT regeneration_jobs_wp_key_unique
    UNIQUE (id, wp_idempotency_key),

  -- Lease coherence: (state, worker_id, lease_expires_at) consistency.
  CONSTRAINT regeneration_jobs_lease_coherent
    CHECK (
      (status = 'pending'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR status IN ('running', 'succeeded', 'failed', 'failed_gates', 'cancelled')
    )
);

-- The CONCURRENCY-LIMIT KEYSTONE: at most one in-flight regen per page.
-- Pending + running rows lock the page; succeeded / failed / failed_gates
-- / cancelled rows are history and stay out of the partial index.
CREATE UNIQUE INDEX regeneration_jobs_one_active_per_page
  ON regeneration_jobs (page_id)
  WHERE status IN ('pending', 'running');

-- Lease-candidate partial index. Drives FOR UPDATE SKIP LOCKED dequeue:
-- candidates are status = 'pending' OR status = 'running' with an
-- expired lease. Terminal states stay out so the index doesn't balloon.
CREATE INDEX idx_regen_jobs_leasable
  ON regeneration_jobs (lease_expires_at NULLS FIRST)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_regen_jobs_page_created
  ON regeneration_jobs (page_id, created_at DESC);
CREATE INDEX idx_regen_jobs_site_created
  ON regeneration_jobs (site_id, created_at DESC);
CREATE INDEX idx_regen_jobs_created_by
  ON regeneration_jobs (created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE regeneration_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON regeneration_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin reads every job; creators read their own. Matches
-- generation_jobs policy from M3-1.
CREATE POLICY regeneration_jobs_read ON regeneration_jobs
  FOR SELECT TO authenticated
  USING (public.auth_role() = 'admin' OR created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- regeneration_events
--
-- Append-only audit log. One row per state transition or notable side
-- effect. Key invariant: the billed Anthropic response event is
-- written BEFORE the cost columns on regeneration_jobs flip, so if
-- the cost-column UPDATE fails the billing is still reconstructible
-- from this table.
-- ---------------------------------------------------------------------------

CREATE TABLE regeneration_events (
  id                         bigserial PRIMARY KEY,
  regeneration_job_id        uuid NOT NULL
    REFERENCES regeneration_jobs(id) ON DELETE CASCADE,

  -- Enumerated at the app layer rather than CHECK here — the event
  -- vocabulary grows over time (new gate names, new WP failure
  -- classes). The existing generation_events table uses the same
  -- open-text shape.
  type                       text NOT NULL,

  -- Structured payload. Shape varies by type; consumers know which
  -- types carry what fields (anthropic_response_received has
  -- {response_id, tokens, cost_cents}, wp_put_succeeded has
  -- {wp_page_id, new_slug}, etc.).
  payload                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_regen_events_job_created
  ON regeneration_events (regeneration_job_id, created_at DESC);
CREATE INDEX idx_regen_events_type
  ON regeneration_events (type);

ALTER TABLE regeneration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON regeneration_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Same read policy as the parent job table: admin sees all; creator
-- of the parent job sees their own events (via a sub-select).
CREATE POLICY regeneration_events_read ON regeneration_events
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM regeneration_jobs j
      WHERE j.id = regeneration_events.regeneration_job_id
        AND j.created_by = auth.uid()
    )
  );
