-- 0056 — AUTH-FOUNDATION P2.4: invalidate existing test-site credentials.
--
-- Phase 2 introduced a guided credential-capture flow (/admin/sites/new
-- and /admin/sites/[id]/edit) with a pre-save WP connection test. The
-- existing test-data sites were created via the legacy modal flow
-- without that test, so their stored credentials may not pass the new
-- capability check (administrator | editor | publish_posts).
--
-- Per the AUTH-FOUNDATION brief: "Migrate existing test-data sites:
-- wipe stored credentials and mark sites as needing re-auth (test data,
-- aggressive migration is fine)."
--
-- The migration:
--   1. DELETE every row from site_credentials. The encrypted bytes are
--      gone — there's no recovery; operator MUST re-enter credentials
--      via the new edit form.
--   2. Flip every non-removed site to status='pending_pairing'. This
--      already exists in the site_status enum (0001_initial_schema)
--      so no enum change is needed. The status:
--        - Is filtered out of the /admin/posts/new site picker
--          (PostsNewClient.tsx) so an operator can't try to publish to
--          a site without credentials.
--        - Renders as a grey dot in the sites list (SitesTable.tsx).
--   3. Bumps sites.updated_at so the recently-changed list ordering
--      surfaces these sites at the top — operator sees them first.
--
-- Forward-only. Caller must understand this WIPES credentials. Per the
-- brief's "test data, aggressive migration is fine" — confirmed safe
-- against the staging dataset which is the only environment this
-- migration runs against today.
--
-- After this migration: every existing site shows pending_pairing.
-- Operator opens /admin/sites/[id]/edit, enters WP user + Application
-- Password, runs Test connection, saves. Site flips back to 'active'
-- via the existing pairing flow (callers of POST /api/sites/[id]
-- with credential updates re-encrypt + insert into site_credentials,
-- and the existing pairing-completion logic flips status when the
-- first successful operation lands).

-- 1. Wipe the encrypted credential bytes.
DELETE FROM site_credentials;

-- 2. Mark every non-removed site as needing re-auth.
UPDATE sites
   SET status = 'pending_pairing',
       updated_at = now()
 WHERE status != 'removed';

-- 3. Audit comment so a future operator querying schema metadata sees
--    why these sites are in pending_pairing.
COMMENT ON COLUMN sites.status IS
  'Lifecycle: pending_pairing (no credentials yet) → active (paired + recent successful operation) → paused (operator suspended) → removed (soft-delete; prefix is freed for reuse). 2026-04-30: AUTH-FOUNDATION P2.4 wiped all credentials and reset every existing site to pending_pairing for re-auth via /admin/sites/[id]/edit.';
