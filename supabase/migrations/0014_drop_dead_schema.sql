-- Drop dead schema tables (M1 stubs never implemented in code)
-- Audit confirmed no application code references these tables:
-- - chat_sessions / chat_sessions_archive: conversation state (dead; chat route uses other mechanism)
-- - pairing_codes: WP plugin initial-pairing (dead; product moved past)
-- - health_checks: historical probe records (dead; /api/health endpoint is separate)
-- - page_history: page edit audit trail (dead; no owner on roadmap)
-- - site_context: cached site metadata (dead; no owner on roadmap)

DROP TABLE IF EXISTS chat_sessions_archive CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS pairing_codes CASCADE;
DROP TABLE IF EXISTS health_checks CASCADE;
DROP TABLE IF EXISTS page_history CASCADE;
DROP TABLE IF EXISTS site_context CASCADE;
