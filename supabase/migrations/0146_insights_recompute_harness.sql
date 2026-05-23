-- PR-06: Recompute cron harness
-- 1. Make cap_generation_runs.cap_campaign_id nullable (insights ops have no campaign)
-- 2. Add find_companies_eligible_for_recompute RPC
-- 3. Add unique index on ins_client_memory for upsert support

-- ---------------------------------------------------------------------------
-- 1. Make cap_campaign_id nullable for non-campaign operations
-- ---------------------------------------------------------------------------
ALTER TABLE cap_generation_runs
  ALTER COLUMN cap_campaign_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. find_companies_eligible_for_recompute
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_companies_eligible_for_recompute(
  min_posts INTEGER DEFAULT 20,
  cutoff_iso TEXT DEFAULT NULL
)
RETURNS TABLE (company_id UUID, post_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ipf.company_id,
    COUNT(*) AS post_count
  FROM ins_post_features ipf
  WHERE ipf.posted_at >= COALESCE(cutoff_iso::timestamptz, NOW() - INTERVAL '90 days')
    AND ipf.deleted_at IS NULL
  GROUP BY ipf.company_id
  HAVING COUNT(*) >= min_posts;
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------------
-- 3. Unique index on ins_client_memory for edit_pattern upsert
-- Allows upsert on (company_id, memory_type, pattern text from payload)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_ins_client_memory_company_type_pattern
  ON ins_client_memory (company_id, memory_type, (payload->>'pattern'))
  WHERE deleted_at IS NULL;
