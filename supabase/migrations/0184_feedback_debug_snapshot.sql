-- 0184_feedback_debug_snapshot.sql
-- Additive: adds debug_snapshot JSONB to feedback_tickets.
-- Captures client environment at submit time for automated debugging.
--
-- Shape: {
--   buildSha: string | null,
--   route: string,
--   vercelEnv: string | null,
--   userEmail: string | null,
--   userAgent: string,
--   viewport: { w: number, h: number, dpr: number },
--   apiEvents: [{ ts, method, path, status, requestId, durationMs }]
-- }

ALTER TABLE feedback_tickets
  ADD COLUMN IF NOT EXISTS debug_snapshot JSONB;

COMMENT ON COLUMN feedback_tickets.debug_snapshot IS
  'Client environment snapshot captured at submit time. Keys: buildSha, route, vercelEnv, userEmail, userAgent, viewport, apiEvents.';
