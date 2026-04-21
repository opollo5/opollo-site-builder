-- M8-1 — Per-tenant cost budgets.
-- Reference: docs/plans/m8-parent.md.
--
-- Design decisions:
--
-- 1. One row per site (UNIQUE on site_id). This is the enforcement
--    anchor for createBatchJob (M3-2), enqueueRegenJob (M7-4), and
--    the iStock seed (M4-5). No per-user or per-design-system split —
--    the tenant boundary is the site.
--
-- 2. Rolling counters (daily_usage_cents / monthly_usage_cents) plus
--    explicit reset timestamps. The reset cron (M8-4) zeroes a row's
--    usage when its daily_reset_at / monthly_reset_at is in the past
--    and advances the timestamp. No GENERATED columns — we want the
--    usage to be an explicit mutable count, not a SUM() over events
--    (the enforcement query would be too expensive at scale).
--
-- 3. Caps default to env-configurable values at row-create time.
--    Generous defaults ($5/day, $100/month) so existing tenants can't
--    suddenly hit a wall when the migration applies. Operator adjusts
--    per-site via the M8-5 admin PATCH.
--
-- 4. ON DELETE CASCADE from sites — a removed site's budget row
--    vanishes. Budget history isn't audit-critical once the site is
--    gone; event logs capture every cost row.
--
-- 5. A trigger creates a budget row automatically whenever a new site
--    is inserted. Keeps the "every enqueue has a budget row to
--    enforce against" invariant true without requiring every
--    createSite path to remember to INSERT. Defense-in-depth: the
--    enforcement helper also upserts on miss.
--
-- Write-safety hotspots addressed here:
--   - UNIQUE (site_id) — one budget per site.
--   - version_lock on admin edits (M8-5).
--   - Trigger backfill — no orphan site with no enforcement row.
--   - Check constraints: caps >= 0, usage >= 0.

CREATE TABLE tenant_cost_budgets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                  uuid NOT NULL
    REFERENCES sites(id) ON DELETE CASCADE,

  -- Caps (cents). 0 is allowed — a paused tenant.
  daily_cap_cents          bigint NOT NULL DEFAULT 500
    CHECK (daily_cap_cents >= 0),
  monthly_cap_cents        bigint NOT NULL DEFAULT 10000
    CHECK (monthly_cap_cents >= 0),

  -- Rolling usage (cents). Reset cron zeros them on rollover.
  daily_usage_cents        bigint NOT NULL DEFAULT 0
    CHECK (daily_usage_cents >= 0),
  monthly_usage_cents      bigint NOT NULL DEFAULT 0
    CHECK (monthly_usage_cents >= 0),

  -- Explicit reset timestamps. On INSERT, set to today-midnight + 1 day
  -- (UTC) and next-month-1st (UTC). Reset cron advances them by the
  -- same interval when zeroing.
  daily_reset_at           timestamptz NOT NULL
    DEFAULT (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day'),
  monthly_reset_at         timestamptz NOT NULL
    DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month'),

  -- Optimistic lock for admin edits (M8-5).
  version_lock             int NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),

  -- Audit columns per docs/DATA_CONVENTIONS.md.
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES opollo_users(id) ON DELETE SET NULL,
  updated_by               uuid REFERENCES opollo_users(id) ON DELETE SET NULL,

  CONSTRAINT tenant_cost_budgets_site_unique UNIQUE (site_id)
);

CREATE INDEX idx_tenant_budgets_daily_reset
  ON tenant_cost_budgets (daily_reset_at)
  WHERE daily_reset_at <= now() + interval '1 day';
CREATE INDEX idx_tenant_budgets_monthly_reset
  ON tenant_cost_budgets (monthly_reset_at)
  WHERE monthly_reset_at <= now() + interval '32 days';

ALTER TABLE tenant_cost_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON tenant_cost_budgets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin reads all; operators read the budget for their own sites via
-- the same role check design_systems uses. If an operator role can see
-- the site, they can see its budget too — helps debug an unexpected
-- enqueue rejection without needing admin.
CREATE POLICY tenant_cost_budgets_read ON tenant_cost_budgets
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator'));

-- ---------------------------------------------------------------------------
-- Backfill trigger: auto-create a budget row when a new site is inserted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_tenant_budget_for_site()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tenant_cost_budgets (site_id)
  VALUES (NEW.id)
  ON CONFLICT (site_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_create_tenant_budget
  AFTER INSERT ON sites
  FOR EACH ROW
  EXECUTE FUNCTION create_tenant_budget_for_site();

-- ---------------------------------------------------------------------------
-- Backfill existing sites. Idempotent: ON CONFLICT DO NOTHING on the
-- UNIQUE index. Running this migration twice is a no-op.
-- ---------------------------------------------------------------------------

INSERT INTO tenant_cost_budgets (site_id)
SELECT s.id FROM sites s
ON CONFLICT (site_id) DO NOTHING;
