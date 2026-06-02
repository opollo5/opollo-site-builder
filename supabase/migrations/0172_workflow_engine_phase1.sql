-- Migration 0172 — Approval Workflow Engine, Phase 1
--
-- Adds the gate-configuration layer, batch-level approval state, and extends
-- existing approval tables with subject-type polymorphism (L14/L15).
--
-- Five independent changes (all additive; safe to apply on a live production DB):
--
--   A. company_workflow_gates       — per-company gate config
--   B. company_workflow_gate_approvers — approver assignment per gate
--   C. image_generation_batches     — approval_status, review_round
--   D. social_approval_requests     — subject_type, subject_id; post_master_id nullable
--   E. social_post_drafts           — workflow_state
--
-- L14: "No workflow-specific approval tables — all gates use social_approval_requests."
-- L15: "workflow_state lives on social_post_drafts."
--
-- Rollback: commented at bottom; safe because all columns are additive.

-- ─── A. Gate configuration ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_workflow_gates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  gate_type     text NOT NULL CHECK (gate_type IN ('copy_review', 'image_review', 'final_signoff')),
  enabled       boolean NOT NULL DEFAULT false,
  pass_rule     text NOT NULL DEFAULT 'any_one' CHECK (pass_rule IN ('all_must', 'any_one')),
  timeout_days  int NOT NULL DEFAULT 14,
  auto_schedule boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, gate_type)
);

CREATE INDEX IF NOT EXISTS idx_workflow_gates_company
  ON company_workflow_gates (company_id);

-- RLS: company members can read their own gates; Opollo staff see all.
ALTER TABLE company_workflow_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_gates_access" ON company_workflow_gates
  FOR ALL USING (
    is_opollo_staff()
    OR is_company_member(company_id)
  );

-- ─── B. Approver assignment per gate ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_workflow_gate_approvers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id             uuid NOT NULL REFERENCES company_workflow_gates(id) ON DELETE CASCADE,
  -- nullable platform_user_id → internal approver (must be a member of the company)
  -- external_email-only     → magic-link approver, no account required
  platform_user_id    uuid REFERENCES platform_users(id) ON DELETE CASCADE,
  external_email      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approver_identity_required
    CHECK (platform_user_id IS NOT NULL OR external_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_workflow_gate_approvers_gate
  ON company_workflow_gate_approvers (gate_id);

-- RLS: scoped via the parent gate's company_id.
ALTER TABLE company_workflow_gate_approvers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workflow_gate_approvers_access" ON company_workflow_gate_approvers
  FOR ALL USING (
    is_opollo_staff()
    OR EXISTS (
      SELECT 1 FROM company_workflow_gates g
      WHERE g.id = gate_id
        AND is_company_member(g.company_id)
    )
  );

-- ─── C. Batch-level approval state (L15 rollup only) ─────────────────────────

ALTER TABLE image_generation_batches
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'none'
    CHECK (approval_status IN (
      'none',
      'pending_review',
      'approved',
      'rejected',
      'escalated_to_admin'
    )),
  ADD COLUMN IF NOT EXISTS review_round int NOT NULL DEFAULT 0;

-- ─── D. social_approval_requests — subject polymorphism (L14) ────────────────
--
-- Extends the backbone table to cover non-social-post subject types without
-- a new table. post_master_id becomes nullable for non-post subjects.
--
-- BACKFILL: existing rows get subject_type='post_copy', subject_id=post_master_id.
-- post_master_id is set-null NOT NULL dropped so image-batch requests can omit it.

ALTER TABLE social_approval_requests
  ADD COLUMN IF NOT EXISTS subject_type text
    CHECK (subject_type IN ('image_batch', 'post_copy', 'post_final')),
  ADD COLUMN IF NOT EXISTS subject_id uuid;

-- Drop NOT NULL on post_master_id so image-batch requests can omit it.
-- Existing rows have it set; the RLS + application guards continue to enforce
-- company scoping. The record_approval_decision RPC is a no-op on post state
-- when post_master_id IS NULL — correct for batch subjects.
ALTER TABLE social_approval_requests
  ALTER COLUMN post_master_id DROP NOT NULL;

-- Backfill existing social-post approval requests.
UPDATE social_approval_requests
  SET subject_type = 'post_copy',
      subject_id   = post_master_id
  WHERE post_master_id IS NOT NULL
    AND subject_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_approval_requests_subject
  ON social_approval_requests (subject_type, subject_id)
  WHERE subject_id IS NOT NULL;

-- ─── E. Workflow state on social_post_drafts (L15) ───────────────────────────
--
-- The content unit's position in the gate sequence. NULL = not in a workflow
-- (all existing drafts — behaviour unchanged). Non-null values are set by the
-- workflow engine as content flows through enabled gates.

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS workflow_state text
    CHECK (workflow_state IN (
      'pending_copy_review',
      'rework_copy',
      'in_image_production',
      'pending_image_review',
      'rework_image',
      'pending_final_signoff',
      'ready_to_schedule',
      'escalated_to_admin'
    ));
-- Existing rows remain NULL — they entered the system before the engine and are
-- treated as "not managed by workflow" throughout the codebase.

-- ─── Rollback (run in reverse to revert) ─────────────────────────────────────
--
-- ALTER TABLE social_post_drafts DROP COLUMN IF EXISTS workflow_state;
--
-- UPDATE social_approval_requests SET subject_type = NULL, subject_id = NULL;
-- ALTER TABLE social_approval_requests ALTER COLUMN post_master_id SET NOT NULL;
-- ALTER TABLE social_approval_requests DROP COLUMN IF EXISTS subject_id;
-- ALTER TABLE social_approval_requests DROP COLUMN IF EXISTS subject_type;
-- DROP INDEX IF EXISTS idx_approval_requests_subject;
--
-- ALTER TABLE image_generation_batches DROP COLUMN IF EXISTS review_round;
-- ALTER TABLE image_generation_batches DROP COLUMN IF EXISTS approval_status;
--
-- DROP TABLE IF EXISTS company_workflow_gate_approvers;
-- DROP TABLE IF EXISTS company_workflow_gates;
