-- 0045 — Optimiser: opt_llm_usage.
-- Reference: spec §4.6 (cost ceiling), §5.1.
--
-- Append-only per-call LLM cost tracking. The Slice 2 sync jobs +
-- Slice 5 alignment scorer / proposal generator both insert one row
-- per LLM call. Daily / monthly rollups are aggregated by SUM() over
-- this table; the budget gate (75% warning, 100% hard cutoff per
-- §4.6) reads the rollup before each new call.
--
-- Schema mirrors the existing tenant_cost_budgets / generation_jobs
-- pattern (input_tokens / output_tokens / cached_tokens / cost cents)
-- so reporting can union the two surfaces if a future pass wants to.

CREATE TABLE opt_llm_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  -- 'alignment_scoring' | 'proposal_generation' | 'page_content_analysis' |
  -- 'variant_generation' (phase 2). Free text so a Phase 2 surface can add
  -- without a migration.
  caller              text NOT NULL,

  -- Origin row id (proposal / alignment_score / etc) for forensic
  -- traceback. Optional — sync-time scoring may have no source row yet.
  source_table        text,
  source_id           uuid,

  model               text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0
    CHECK (input_tokens >= 0),
  output_tokens       integer NOT NULL DEFAULT 0
    CHECK (output_tokens >= 0),
  cached_tokens       integer NOT NULL DEFAULT 0
    CHECK (cached_tokens >= 0),

  -- USD * 1000000 (micros) so we don't have to round-trip through
  -- floating-point at write time. Aggregations cast back to dollars
  -- at the read.
  cost_usd_micros     bigint NOT NULL DEFAULT 0
    CHECK (cost_usd_micros >= 0),

  request_id          text,
  anthropic_request_id text,

  -- Outcome — 'ok' | 'budget_exceeded' (rejected pre-call) | 'error'.
  -- Pre-call rejections are recorded so the budget surface shows what
  -- would have been spent.
  outcome             text NOT NULL DEFAULT 'ok'
    CHECK (outcome IN ('ok', 'budget_exceeded', 'error')),
  error_code          text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opt_llm_usage_client_created_idx
  ON opt_llm_usage (client_id, created_at DESC);

-- Monthly rollup hot path: SUM(cost_usd_micros) WHERE client_id = $1
-- AND created_at >= date_trunc('month', now()). Indexed for the
-- gate check that runs before every LLM call.
CREATE INDEX opt_llm_usage_client_month_idx
  ON opt_llm_usage (client_id, created_at)
  WHERE outcome = 'ok';

ALTER TABLE opt_llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_llm_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_llm_usage_read ON opt_llm_usage
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
