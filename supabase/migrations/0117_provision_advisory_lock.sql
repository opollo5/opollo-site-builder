-- BSP-2: race-safe bundle.social team provisioning.
--
-- Primary race protection lives in TypeScript (in-process Promise dedup,
-- see lib/platform/social/bundle-social/provision.ts). This migration
-- adds a stable lock-key helper for advisory locks so cross-process
-- callers (e.g., parallel cron workers, integration tests) can serialise
-- their provisioning attempts at the database layer if needed.
--
-- Why both layers:
--   * In-process Map<string, Promise<string>> handles the common case
--     (single Vercel function instance fielding parallel requests).
--   * Advisory lock helper handles the cross-process edge case
--     (two Vercel functions hitting the same uncommitted row at once).
--
-- pg_advisory_xact_lock takes a bigint key. We hash the company UUID
-- to a stable bigint via md5 + bit-cast. IMMUTABLE so the planner can
-- inline the call.

CREATE OR REPLACE FUNCTION provision_company_lock_key(company_id uuid)
  RETURNS bigint
  LANGUAGE sql
  IMMUTABLE STRICT
AS $$
  SELECT ('x' || substr(md5(company_id::text), 1, 16))::bit(64)::bigint;
$$;

COMMENT ON FUNCTION provision_company_lock_key(uuid) IS
  'Stable bigint hash of a company UUID for use with pg_advisory_xact_lock. '
  'Used by BSP-2 race-safe provisioning paths. Primary dedup is in-process; '
  'this helper exists for cross-process serialisation when needed.';
