-- Migration 0149: ins_external_provider_costs — track Apify (and future) provider spend

CREATE TABLE ins_external_provider_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  external_run_id TEXT,
  cost_usd NUMERIC(10, 4) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_external_provider_costs_company_provider
  ON ins_external_provider_costs (company_id, provider, created_at DESC);

ALTER TABLE ins_external_provider_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY ins_external_provider_costs_staff_read ON ins_external_provider_costs
  FOR SELECT USING (is_opollo_staff());

CREATE POLICY ins_external_provider_costs_staff_write ON ins_external_provider_costs
  FOR ALL
  USING (is_opollo_staff())
  WITH CHECK (is_opollo_staff());
