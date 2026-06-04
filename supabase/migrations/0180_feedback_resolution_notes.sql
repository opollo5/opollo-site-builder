-- 0180_feedback_resolution_notes.sql
-- Additive: adds resolution_notes (nullable text) to feedback_tickets.
-- Written by bugs:push when Claude Code files the fix; read by the Fix-attempt
-- panel on the ticket detail. bugs:push may NOT write terminal states — that
-- guard lives in push.ts (not enforced at the schema level).

ALTER TABLE feedback_tickets
  ADD COLUMN IF NOT EXISTS resolution_notes text;

COMMENT ON COLUMN feedback_tickets.resolution_notes IS
  'Working-analog / Diff / Fix summary written by bugs:push after a Claude Code fix attempt. Null = no fix attempted yet.';
