-- 0022 — M13-5a appearance schema.
-- Reference: docs/plans/m13-parent.md §M13-5 (rescoped 2026-04-24 to
-- palette-only sync per pre-flight check; typography + spacing globals
-- on BACKLOG).
--
-- Two additions:
--
-- 1. sites.kadence_installed_at + kadence_globals_synced_at — nullable
--    timestamptz columns that record the wall-clock of the last
--    successful install and globals-sync respectively. Updated under
--    sites.version_lock CAS in M13-5c / M13-5d. NULL means "never
--    installed / synced"; the Appearance panel renders the Install or
--    Sync CTA accordingly.
--
--    The columns are intentionally NULLABLE rather than DEFAULT now():
--    M2-era sites predate Kadence and must stay NULL until the
--    operator explicitly runs the install from the Appearance panel.
--    Stamping a default would misrepresent every existing row.
--
-- 2. appearance_events — audit log for every Kadence-bound mutation
--    AND dry-run. Schema mirrors the batch worker's generation_events
--    table: id + site_id + event (CHECK enum) + details (jsonb) +
--    created_at + created_by. Every confirmed mutation writes one row.
--    Every dry-run writes one too, so the operator can see recent
--    activity in the Appearance panel even when they didn't actually
--    push the button.
--
--    The event enum is additive — M13-5b onwards will add events per
--    sub-slice. Starting set covers install + palette sync + rollback
--    paths; typography + spacing events are reserved names that the
--    BACKLOG slice will add via a future migration when it ships.
--
-- Write-safety notes:
--   - No foreign-key CASCADE on appearance_events.site_id → sites.id.
--     ON DELETE SET NULL would orphan events; ON DELETE CASCADE would
--     lose audit history when a site is soft-deleted (which is the
--     typical delete path). We use ON DELETE RESTRICT so a site row
--     cannot be hard-deleted while audit rows exist. Soft-delete
--     (sites.status='removed') is the operator-facing delete path and
--     it preserves both.
--   - No UNIQUE constraint on (site_id, event, created_at) — multiple
--     dry-runs in the same millisecond are plausible and benign; we
--     don't want a collision to block logging.

ALTER TABLE sites
  ADD COLUMN kadence_installed_at timestamptz,
  ADD COLUMN kadence_globals_synced_at timestamptz;

COMMENT ON COLUMN sites.kadence_installed_at IS
  'Wall-clock of the last successful Kadence theme install + activate via the M13-5c route. NULL = never installed (includes every M2-era site pre-M13-5). Updated under sites.version_lock CAS.';
COMMENT ON COLUMN sites.kadence_globals_synced_at IS
  'Wall-clock of the last successful DS palette → kadence_blocks_colors sync via the M13-5d route. NULL = palette never synced. Updated under sites.version_lock CAS in the same transaction shape as the appearance_events write.';

-- ---------------------------------------------------------------------
-- appearance_events
-- ---------------------------------------------------------------------

CREATE TABLE appearance_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid        NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  event       text        NOT NULL,
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid        REFERENCES opollo_users(id) ON DELETE SET NULL,

  CONSTRAINT appearance_events_event_enum CHECK (event IN (
    -- Preflight visibility — lets the panel surface recent "operator
    -- checked readiness" activity without requiring a mutation.
    'preflight_run',
    -- Kadence install flow (M13-5c).
    'install_dry_run',
    'install_confirmed',
    'install_completed',
    'install_failed',
    -- Palette sync flow (M13-5d).
    'globals_dry_run',
    'globals_confirmed',
    'globals_completed',
    'globals_failed',
    -- Rollback flow (M13-5d).
    'rollback_requested',
    'rollback_completed',
    'rollback_failed'
  ))
);

COMMENT ON TABLE appearance_events IS
  'Audit log for Kadence-bound operations (install, palette sync, rollback). One row per dry-run or confirmed call. Retained indefinitely — rows are write-once, never updated.';
COMMENT ON COLUMN appearance_events.event IS
  'CHECK-enum event type. See docs/plans/m13-parent.md §M13-5 for the state-machine narrative. Additive: new events require a migration (CHECK constraint replacement).';
COMMENT ON COLUMN appearance_events.details IS
  'Free-form jsonb payload. Expected shapes per event type — install_completed: { prior_active_theme_slug, installed_version, wp_response_id }. globals_completed: { previous_globals, new_globals, ds_version }. failed events: { error_code, translated_message, http_status }.';

-- Read path for the Appearance panel + rollback lookups.
CREATE INDEX idx_appearance_events_site_created
  ON appearance_events (site_id, created_at DESC);

-- Rollback path: find the most recent globals_completed event for a site.
CREATE INDEX idx_appearance_events_site_event
  ON appearance_events (site_id, event, created_at DESC);

-- ---------------------------------------------------------------------
-- RLS: service-role-only (matches M1a policy defaults).
-- ---------------------------------------------------------------------

ALTER TABLE appearance_events ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; no authenticated-role policy today. If M2b
-- patterns land for appearance_events later, they'll mirror the
-- generation_events shape (site-scoped read for operator/admin; no
-- authenticated-role writes — writes go through service-role helpers).
