-- M15-2 #4 — missing index on regeneration_jobs.created_at
--
-- lib/regeneration-publisher.ts checkDailyBudget() does:
--   .from("regeneration_jobs").select("cost_usd_cents").gte("created_at", startOfDay)
--
-- Without an index, every enqueue runs a seq-scan. This index supports the
-- range predicate so PostgreSQL can do an index scan for today's rows only.
CREATE INDEX IF NOT EXISTS idx_regen_jobs_created_at
    ON regeneration_jobs (created_at DESC);
