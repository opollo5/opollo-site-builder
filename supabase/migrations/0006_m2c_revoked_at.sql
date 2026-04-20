-- M2c-1 — App-layer session revocation marker
-- Reference: M2c plan thread + the "C + B hybrid" decision after PR #17's
-- first CI failures revealed that stock supabase/auth has no mechanism
-- for immediate mid-session invalidation of a live access token.
--
-- Design:
--
-- 1. Roles are authoritative on opollo_users.role, looked up fresh on every
--    request by lib/auth.ts getCurrentUser(). That makes role
--    changes take effect on the very next request with no revocation
--    needed — the M2d promote/demote flow relies on this.
--
-- 2. For the emergency "kick this user out RIGHT NOW" case (compromised
--    credentials, departing employee, etc), we need a real revocation.
--    We can't rely on GoTrue to do it — its /user handler doesn't
--    validate `sid` against auth.sessions, so deleting session rows
--    doesn't invalidate live JWTs. Banning works but permanently locks
--    the user until someone explicitly unbans, which is wrong for any
--    non-terminal case.
--
-- 3. App-layer marker: opollo_users.revoked_at. getCurrentUser compares
--    the JWT's iat claim against this column. Any access token issued
--    BEFORE revoked_at is rejected as null (→ 401 from requireRole).
--    The user can still log in fresh — the new JWT has iat > revoked_at
--    and passes.
--
-- 4. lib/auth-revoke.ts revokeUserSessions(userId) sets this column to
--    now() and also performs the "soft" sweep
--    (DELETE auth.sessions/refresh_tokens) so the user's supabase-js
--    client can't silently auto-refresh past the revocation. Belt and
--    braces.

ALTER TABLE opollo_users
  ADD COLUMN revoked_at timestamptz NULL;

COMMENT ON COLUMN opollo_users.revoked_at IS
  'When set, all access tokens with iat < revoked_at are rejected by '
  'lib/auth.ts getCurrentUser(). Written by revokeUserSessions() in '
  'lib/auth-revoke.ts; reset to NULL by the same flow on next successful '
  'login is NOT automatic — the check compares iat, so new logins with '
  'iat > revoked_at pass without clearing.';
