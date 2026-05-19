-- Migration 0139: add monthly_objective_template to cap_subscriptions
-- Nullable — NULL means the cron will skip this subscription (with a service_health_event)
-- and require the operator to set a template before auto-generation can run.

ALTER TABLE cap_subscriptions
  ADD COLUMN IF NOT EXISTS monthly_objective_template TEXT;

COMMENT ON COLUMN cap_subscriptions.monthly_objective_template IS
  'Default objective text used when monthly campaigns auto-generate via cron. '
  'Required for cron to create campaigns. Set per-subscription via CAP admin UI.';

-- Backfill: subscriptions that have had a published post get a sensible default.
-- Others stay NULL to force the operator to write a specific objective.
UPDATE cap_subscriptions s
SET monthly_objective_template =
  'Drive LinkedIn engagement and awareness for ' ||
  COALESCE((SELECT name FROM platform_companies c WHERE c.id = s.company_id), 'the company')
FROM (SELECT id, company_id FROM cap_subscriptions WHERE monthly_objective_template IS NULL) sub
WHERE s.id = sub.id
  AND EXISTS (
    SELECT 1 FROM cap_campaign_posts cp
    JOIN cap_campaigns ca ON cp.cap_campaign_id = ca.id
    WHERE ca.cap_subscription_id = s.id
      AND cp.status = 'published'
  );
