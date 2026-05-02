-- 0062 — AUTH-FOUNDATION P4.1: email-2FA schema (login_challenges + trusted_devices).
--
-- Two tables underpin the email-approval second factor that fronts
-- every login from an untrusted device when AUTH_2FA_ENABLED is on:
--
--   1. login_challenges — one row per password-validated sign-in
--      that needs an approval click. The id doubles as the
--      challenge_id used in /login/check-email URLs and the polling
--      endpoint. token_hash is sha-256 of a 32-byte random; the raw
--      token only ever appears in the approval email. 15-minute
--      expiry. ip_hash captures the originating client (peppered
--      with IP_HASH_PEPPER) for audit + future anomaly detection.
--      ua_string is metadata for the email body's "Device: …" line.
--
--   2. trusted_devices — one row per (user_id, device_id) that has
--      successfully completed an approval flow. device_id is server-
--      generated per challenge and persisted in a signed HttpOnly
--      cookie. trust_until = created_at + 30 days unless revoked.
--      ua_string is metadata only — trust matching uses
--      (user_id, device_id) ALONE (UA strings change on browser
--      updates and shouldn't break trust).
--
-- Forward-only. RLS service-role-only on both tables; the auth
-- pipeline reads + writes via lib/2fa/* with the service-role
-- client.
--
-- Recovery preamble: the 0031 version-prefix collision (resolved in
-- #371/#372/#373) blocked this migration from being recorded. On
-- environments where an earlier `supabase db push` got far enough to
-- create these tables before failing on a later statement, the
-- tables now exist with no schema_migrations row. Drop them up front
-- so the CREATE statements below can run cleanly. Auth flows weren't
-- functional pre-recovery, so these tables are empty in every
-- affected environment — nothing to preserve.
DROP TABLE IF EXISTS trusted_devices CASCADE;
DROP TABLE IF EXISTS login_challenges CASCADE;

-- ----------------------------------------------------------------------------
-- login_challenges
-- ----------------------------------------------------------------------------

CREATE TABLE login_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES opollo_users(id) ON DELETE CASCADE,

  -- Generated server-side per challenge. On approval, this id is
  -- written into a signed cookie and (if trust_device=true) into
  -- trusted_devices.
  device_id    uuid NOT NULL,

  -- sha-256 of a 32-byte random. Raw token only appears in the email.
  token_hash   text NOT NULL UNIQUE,

  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'expired', 'consumed')),

  ip_hash      text,                 -- peppered with IP_HASH_PEPPER
  ua_string    text,                 -- raw UA for the email body

  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  approved_at  timestamptz
);

-- Hot-path query: token_hash lookup from /auth/approve.
-- The UNIQUE on token_hash gives this for free; no extra index needed.

-- Polling lookup by (user_id, status). Polling endpoint hits this
-- every 3 seconds while the user waits.
CREATE INDEX login_challenges_user_status_idx
  ON login_challenges (user_id, status, created_at DESC);

-- Rate-limit query: count challenges per email per hour.
-- Joined to opollo_users via user_id, so no email column needed here.
CREATE INDEX login_challenges_user_created_idx
  ON login_challenges (user_id, created_at DESC);

ALTER TABLE login_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON login_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE login_challenges IS
  'AUTH-FOUNDATION P4 email-2FA challenges. One row per password-valid sign-in that needs an email approval click. id doubles as challenge_id in URLs. 15-min expiry; status flips pending → approved → consumed (or expired). Added 2026-04-30.';

COMMENT ON COLUMN login_challenges.device_id IS
  'Server-generated per challenge. Persisted in the signed device_id cookie on completion + into trusted_devices when trust_device=true. Trust matching uses (user_id, device_id) ALONE.';

COMMENT ON COLUMN login_challenges.token_hash IS
  'sha-256 of a 32-byte random. Raw token only appears in the approval email.';

-- ----------------------------------------------------------------------------
-- trusted_devices
-- ----------------------------------------------------------------------------

CREATE TABLE trusted_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES opollo_users(id) ON DELETE CASCADE,

  -- Matches a login_challenges.device_id that completed approval.
  device_id       uuid NOT NULL,

  -- Metadata for /admin/account/devices display only — NOT used for
  -- trust matching (UA strings change on browser updates).
  ua_string       text,
  ip_hash         text,                 -- peppered

  trusted_until   timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  last_used_at    timestamptz NOT NULL DEFAULT now()
);

-- Trust-matching lookup: hot path on every login when 2FA is on.
-- Partial index so revoked/expired rows don't bloat the seek.
CREATE INDEX trusted_devices_active_idx
  ON trusted_devices (user_id, device_id)
  WHERE revoked_at IS NULL;

-- /admin/account/devices listing.
CREATE INDEX trusted_devices_user_listing_idx
  ON trusted_devices (user_id, created_at DESC);

-- Idempotent UPSERT key. A second successful approval for the same
-- (user_id, device_id) updates last_used_at + extends trusted_until
-- rather than creating a duplicate row.
CREATE UNIQUE INDEX trusted_devices_user_device_uniq
  ON trusted_devices (user_id, device_id);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON trusted_devices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE trusted_devices IS
  'AUTH-FOUNDATION P4 trusted-device registry. One row per (user_id, device_id) that completed an email-approval flow with trust_device=true. Trust matching uses (user_id, device_id) only. ua_string + ip_hash are metadata for /admin/account/devices display. Added 2026-04-30.';

COMMENT ON COLUMN trusted_devices.ua_string IS
  'User-Agent header from the approval-completing request. METADATA ONLY — trust matching does NOT use UA (browser updates rotate UA strings; UA-coupled trust would break legitimately-trusted devices).';

COMMENT ON COLUMN trusted_devices.ip_hash IS
  'IP_HASH_PEPPER-peppered sha-256 of the originating IP. Stored to surface "this device" hints in the listing without retaining raw IPs.';
