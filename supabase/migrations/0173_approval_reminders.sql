-- Migration 0173 — Approval Workflow Engine, Phase 2: reminder tracking
--
-- Adds four timestamptz columns to social_approval_requests for exactly-once
-- QStash reminder/escalation tracking (the IS NULL guard pattern used by the
-- invitation callback system).
--
-- Each column serves as an idempotency anchor for its handler:
--   reminder_day3_sent_at  — day-3 nudge sent; handler no-ops if not null
--   reminder_day7_sent_at  — day-7 nudge sent
--   reminder_day14_sent_at — day-14 final notice sent to approver(s)
--   admin_alerted_at       — Opollo-admin dark-client alert sent (day 14)
--
-- All nullable (null = not yet sent). All default null. Safe to apply on live
-- production — additive only, no data changes.
--
-- Also: reminder_day0_sent_at for the initial magic-link invite email that
-- should be sent the moment the approval request is created. Without this,
-- the day-0 send can fire twice if createBatchApprovalRequest is retried.
--
-- Rollback: ALTER TABLE social_approval_requests
--   DROP COLUMN IF EXISTS reminder_day0_sent_at,
--   DROP COLUMN IF EXISTS reminder_day3_sent_at,
--   DROP COLUMN IF EXISTS reminder_day7_sent_at,
--   DROP COLUMN IF EXISTS reminder_day14_sent_at,
--   DROP COLUMN IF EXISTS admin_alerted_at;

ALTER TABLE social_approval_requests
  ADD COLUMN IF NOT EXISTS reminder_day0_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day3_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day7_sent_at  timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_day14_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_alerted_at       timestamptz;
