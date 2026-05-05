-- M15-2 #5 — Drop cancel_requested_at from transfer_jobs.
--
-- The transfer-worker pipeline (process-transfer cron + lib/transfer-worker.ts)
-- has been retired: transfer_job_items.state='pending' count reached 0 and the
-- entire worker stack was removed in this PR. cancel_requested_at was only
-- ever read by that worker to abort an in-flight job; no application code
-- references it after this change.
ALTER TABLE transfer_jobs DROP COLUMN IF EXISTS cancel_requested_at;
