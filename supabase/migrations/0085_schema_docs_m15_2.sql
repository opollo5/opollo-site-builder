-- ---------------------------------------------------------------------------
-- 0085 — Schema documentation: service-role-only tables + RLS intent.
--
-- Closes M15-2 #12/#13/#14 from docs/BACKLOG.md.
--
-- #12 / M15-5 #12 — image_usage RLS excludes viewer (intentional)
--   The top-of-file summary in 0010 said "viewer read only" for all three
--   image tables, but the inline policy comment and the policy itself both
--   say "admin + operator". The exclusion is deliberate: image_usage holds
--   WP transfer bookkeeping (wp_media_id, idempotency_marker, transfer state)
--   that operators manage but viewers have no operational use case for.
--
-- #13 — Service-role-only write tables undocumented
--   generation_*, transfer_*, regeneration_*, tenant_cost_budgets have no
--   authenticated INSERT/UPDATE/DELETE policies. All production writes use
--   getServiceRoleClient(). A COMMENT ON TABLE surfaces this at schema
--   introspection time so a future dev hitting 42501 can find the answer.
--
-- #14 — opollo_config authenticated read is intentionally absent
--   Protecting first_admin_email from enumeration. Same pattern — adding a
--   table comment so the reasoning doesn't live only in commit history.
-- ---------------------------------------------------------------------------

-- #12 — Clarify that viewer is intentionally excluded from image_usage_read.
COMMENT ON POLICY image_usage_read ON image_usage IS
  'viewer role intentionally excluded. image_usage holds WP transfer bookkeeping '
  '(wp_media_id, idempotency_marker, transfer state) that is operator-managed. '
  'Viewers see image_library and image_metadata rows but have no operational use '
  'for per-site transfer status. See migration 0010 inline comment for original '
  'design rationale.';

-- #13 — Service-role-only write tables.
COMMENT ON TABLE generation_jobs IS
  'Worker-managed table. All INSERT/UPDATE operations use getServiceRoleClient(); '
  'no authenticated write policy is intentional. Using createRouteAuthClient() on '
  'this table will return 42501.';

COMMENT ON TABLE generation_job_pages IS
  'Worker-managed table. All INSERT/UPDATE operations use getServiceRoleClient(); '
  'no authenticated write policy is intentional.';

COMMENT ON TABLE generation_events IS
  'Append-only event log. All INSERTs use getServiceRoleClient(); '
  'no authenticated write policy is intentional.';

COMMENT ON TABLE transfer_jobs IS
  'Worker-managed table. All INSERT/UPDATE operations use getServiceRoleClient(); '
  'no authenticated write policy is intentional. Transfer cron removed 2026-05-04 '
  '(migration 0084); table retained for historical rows.';

COMMENT ON TABLE transfer_job_items IS
  'Worker-managed table. All INSERT/UPDATE operations use getServiceRoleClient(); '
  'no authenticated write policy is intentional.';

COMMENT ON TABLE transfer_events IS
  'Append-only event log. All INSERTs use getServiceRoleClient(); '
  'no authenticated write policy is intentional. '
  'Note: PK is uuid (unlike generation_events / regeneration_events bigserial) — '
  'cosmetic inconsistency; see M15-2 #8 in docs/BACKLOG.md.';

COMMENT ON TABLE regeneration_jobs IS
  'Worker-managed table. All INSERT/UPDATE operations use getServiceRoleClient(); '
  'no authenticated write policy is intentional.';

COMMENT ON TABLE regeneration_events IS
  'Append-only event log. All INSERTs use getServiceRoleClient(); '
  'no authenticated write policy is intentional.';

COMMENT ON TABLE tenant_cost_budgets IS
  'Budget tracking for tenant cost controls. All INSERT/UPDATE operations use '
  'getServiceRoleClient(); no authenticated write policy is intentional. '
  'Reads are admin-only via auth_role() check.';

-- #14 — opollo_config authenticated read is intentionally absent.
COMMENT ON TABLE opollo_config IS
  'Config key-value store. No authenticated SELECT policy is intentional: '
  'first_admin_email must not be enumerable by authenticated users. '
  'All reads and writes use getServiceRoleClient().';
