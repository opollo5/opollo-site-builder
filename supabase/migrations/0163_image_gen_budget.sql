-- 0163: per-company image-generation budget (B3).
--
-- §1.3 of the mass-image-gen brief: each company gets a hard monthly cap on
-- image-generation spend. Default $20/month = 2000 cents. Budget is enforced
-- at the batch dispatch endpoint (pre-flight) and incremented per
-- successfully-completed job (not preview, not failure).
--
-- §1.7: budget is measured in jobs, not source rows. One source row × three
-- distinct aspect ratios = three jobs = three increments.
--
-- Write-safety hotspots:
--   - UNIQUE (company_id, month) on image_gen_spend lets the qstash handler
--     UPSERT increments atomically — no double-counting under concurrent
--     completions of the same batch.
--   - spend_cents bounded by the budget at dispatch time, not at increment
--     time. The handler always increments — exceeding budget by the in-flight
--     jobs (<= concurrency cap) is acceptable; the next batch is rejected.

-- ─── platform_companies — budget cap column ─────────────────────────────────

ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS monthly_image_gen_budget_cents INT NOT NULL DEFAULT 2000;

COMMENT ON COLUMN platform_companies.monthly_image_gen_budget_cents IS
  'B3: per-company monthly image-generation budget in cents. Default 2000 = $20. Enforced at batch dispatch.';

-- ─── image_gen_spend — per-company per-month accumulator ────────────────────

CREATE TABLE IF NOT EXISTS image_gen_spend (
  company_id  UUID        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  month       DATE        NOT NULL,                -- always first-of-month (UTC)
  spend_cents INT         NOT NULL DEFAULT 0,
  notified_80_at TIMESTAMPTZ,                      -- set the first time the 80% threshold is crossed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, month)
);

CREATE INDEX IF NOT EXISTS idx_image_gen_spend_month
  ON image_gen_spend(month);

ALTER TABLE image_gen_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_gen_spend_company_read ON image_gen_spend;
CREATE POLICY image_gen_spend_company_read
  ON image_gen_spend FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id    = auth.uid()
        AND pcu.company_id = image_gen_spend.company_id
        AND pcu.role IN ('editor', 'approver', 'admin')
    )
  );

-- All writes are service-role only (the qstash handler increments after a
-- successful generation). No INSERT/UPDATE policy for authenticated.
