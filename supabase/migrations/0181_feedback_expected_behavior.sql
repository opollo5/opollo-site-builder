-- 0181_feedback_expected_behavior.sql
-- Additive: adds expected_behavior (nullable text) to feedback_tickets.
-- Captures "what did you expect to happen?" separately from description
-- ("what happened?"), so Claude Code sees expected-vs-actual in bugs:pull output.

ALTER TABLE feedback_tickets
  ADD COLUMN IF NOT EXISTS expected_behavior text;

COMMENT ON COLUMN feedback_tickets.expected_behavior IS
  'What the reporter expected to happen. Stored separately from description so both fields feed expected-vs-actual context to Claude Code via bugs:pull.';
