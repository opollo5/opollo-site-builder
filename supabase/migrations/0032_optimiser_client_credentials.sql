-- 0032 — Optimiser: opt_client_credentials.
-- Reference: spec §4.1 / §4.2 / §4.3 (Ads / Clarity / GA4 auth).
--
-- Design decisions encoded here:
--
-- 1. One row per (client_id, source). 'source' is one of the four
--    Phase 1 data providers. CHECK over ENUM so Phase 2 additions
--    (LeadSource, Bing Ads) don't need a type ALTER.
--
-- 2. Credentials encrypted at rest. The spec's intent (§5.1) is
--    Supabase Vault, but the existing Site Builder connector
--    (site_credentials, 0001) uses AES-256-GCM with OPOLLO_MASTER_KEY
--    via lib/encryption.ts. Matching the existing pattern keeps a
--    single chain-of-custody for credential encryption across the
--    project — see Slice 1 PR description.
--
-- 3. ciphertext / iv / key_version columns mirror the site_credentials
--    shape exactly. lib/encryption.ts passes through unchanged.
--
-- 4. status + last_error_code track connector health for §7.3 failure
--    surfaces. last_synced_at lets the UI show "fetched X minutes ago".
--
-- 5. ON DELETE CASCADE from opt_clients — credentials are owned by the
--    client row and have no audit value once the client is gone.

CREATE TABLE opt_client_credentials (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  source                      text NOT NULL
    CHECK (source IN ('google_ads', 'clarity', 'ga4', 'pagespeed')),

  -- Free-form source-specific identifier shown to staff (Ads customer id,
  -- Clarity project id, GA4 property id, etc).
  external_account_id         text,
  external_account_label      text,

  ciphertext                  bytea NOT NULL,
  iv                          bytea NOT NULL,
  key_version                 integer NOT NULL DEFAULT 1
    CHECK (key_version >= 1),

  status                      text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'expired', 'misconfigured', 'disconnected')),
  last_error_code             text,
  last_error_message          text,
  last_synced_at              timestamptz,
  last_attempted_at           timestamptz,

  -- OAuth token expiry where the source exposes one (Ads, GA4). Lets
  -- the engine pre-empt expiry-driven failures with a banner before
  -- the next sync run.
  refresh_token_expires_at    timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX opt_client_credentials_client_source_uniq
  ON opt_client_credentials (client_id, source);

CREATE INDEX opt_client_credentials_status_idx
  ON opt_client_credentials (status)
  WHERE status != 'connected';

ALTER TABLE opt_client_credentials ENABLE ROW LEVEL SECURITY;

-- Service-role only. Credentials never reach the authenticated role:
-- the engine reads them inside server-side jobs and the UI receives
-- only the redacted status / error fields via lib/optimiser helpers.
CREATE POLICY service_role_all ON opt_client_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);
