import "server-only";

import { decrypt, encrypt } from "@/lib/encryption";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import type {
  OptCredentialSource,
  OptCredentialStatus,
} from "./types";

// ---------------------------------------------------------------------------
// opt_client_credentials helpers.
//
// All reads/writes go through the service-role client — opt_client_credentials
// is service-role-only by RLS policy, so the authenticated client cannot
// touch this table directly. The UI receives only redacted status fields
// (status / last_error_code / last_synced_at) via lib/optimiser API
// helpers, never the ciphertext.
//
// Encryption matches lib/encryption.ts (AES-256-GCM, OPOLLO_MASTER_KEY).
// Same key version contract as site_credentials so the existing rotation
// playbook applies unchanged.
// ---------------------------------------------------------------------------

export type StoredCredential = {
  id: string;
  client_id: string;
  source: OptCredentialSource;
  external_account_id: string | null;
  external_account_label: string | null;
  status: OptCredentialStatus;
  last_error_code: string | null;
  last_error_message: string | null;
  last_synced_at: string | null;
  last_attempted_at: string | null;
  refresh_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DecryptedSecret = {
  /**
   * Source-specific secret payload, parsed from JSON. Shape per source:
   *   google_ads: { refresh_token, customer_id, login_customer_id? }
   *   clarity:    { api_token }
   *   ga4:        { refresh_token, property_id, service_account_json? }
   *   pagespeed:  { api_key }
   */
  payload: Record<string, unknown>;
  keyVersion: number;
};

/** Insert or replace credentials for (client, source). Existing row's
 * status is reset to 'connected' and any prior error is cleared. */
export async function upsertCredential(args: {
  clientId: string;
  source: OptCredentialSource;
  payload: Record<string, unknown>;
  externalAccountId?: string;
  externalAccountLabel?: string;
  refreshTokenExpiresAt?: Date | null;
  updatedBy?: string | null;
}): Promise<StoredCredential> {
  const supabase = getServiceRoleClient();
  const plaintext = JSON.stringify(args.payload);
  const enc = encrypt(plaintext);

  const { data, error } = await supabase
    .from("opt_client_credentials")
    .upsert(
      {
        client_id: args.clientId,
        source: args.source,
        external_account_id: args.externalAccountId ?? null,
        external_account_label: args.externalAccountLabel ?? null,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        key_version: enc.keyVersion,
        status: "connected" as OptCredentialStatus,
        last_error_code: null,
        last_error_message: null,
        refresh_token_expires_at: args.refreshTokenExpiresAt
          ? args.refreshTokenExpiresAt.toISOString()
          : null,
        updated_by: args.updatedBy ?? null,
      },
      { onConflict: "client_id,source" },
    )
    .select(
      "id, client_id, source, external_account_id, external_account_label, status, last_error_code, last_error_message, last_synced_at, last_attempted_at, refresh_token_expires_at, created_at, updated_at",
    )
    .single();
  if (error || !data) {
    throw new Error(
      `upsertCredential failed for client=${args.clientId} source=${args.source}: ${error?.message ?? "no data"}`,
    );
  }
  return data as StoredCredential;
}

export async function getCredentialMeta(
  clientId: string,
  source: OptCredentialSource,
): Promise<StoredCredential | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_credentials")
    .select(
      "id, client_id, source, external_account_id, external_account_label, status, last_error_code, last_error_message, last_synced_at, last_attempted_at, refresh_token_expires_at, created_at, updated_at",
    )
    .eq("client_id", clientId)
    .eq("source", source)
    .maybeSingle();
  if (error) {
    throw new Error(
      `getCredentialMeta failed for client=${clientId} source=${source}: ${error.message}`,
    );
  }
  return (data as StoredCredential | null) ?? null;
}

/**
 * Decrypt the credential payload. Throws if no row, the row is
 * disconnected, or decryption fails. Callers must catch + flip the
 * status to 'misconfigured' / 'expired' on failure (use
 * markCredentialError below).
 */
export async function readCredential(
  clientId: string,
  source: OptCredentialSource,
): Promise<DecryptedSecret> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_credentials")
    .select("ciphertext, iv, key_version, status")
    .eq("client_id", clientId)
    .eq("source", source)
    .single();
  if (error || !data) {
    throw new Error(
      `readCredential: no credentials for client=${clientId} source=${source}`,
    );
  }
  if (data.status === "disconnected") {
    throw new Error(
      `readCredential: credentials for client=${clientId} source=${source} are disconnected`,
    );
  }
  const ciphertext = Buffer.from(data.ciphertext as string | Buffer);
  const iv = Buffer.from(data.iv as string | Buffer);
  const text = decrypt(ciphertext, iv, data.key_version as number);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `readCredential: payload for client=${clientId} source=${source} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return { payload: parsed, keyVersion: data.key_version as number };
}

/** Bump status to 'expired' / 'misconfigured' / 'disconnected'. */
export async function markCredentialError(
  clientId: string,
  source: OptCredentialSource,
  status: Exclude<OptCredentialStatus, "connected">,
  code: string,
  message: string,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("opt_client_credentials")
    .update({
      status,
      last_error_code: code,
      last_error_message: message,
      last_attempted_at: new Date().toISOString(),
    })
    .eq("client_id", clientId)
    .eq("source", source);
  if (error) {
    logger.error("optimiser.credentials.mark_error_failed", {
      client_id: clientId,
      source,
      status,
      code,
      error: error.message,
    });
  }
}

export async function markCredentialSynced(
  clientId: string,
  source: OptCredentialSource,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("opt_client_credentials")
    .update({
      last_synced_at: now,
      last_attempted_at: now,
      status: "connected",
      last_error_code: null,
      last_error_message: null,
    })
    .eq("client_id", clientId)
    .eq("source", source);
  if (error) {
    logger.error("optimiser.credentials.mark_synced_failed", {
      client_id: clientId,
      source,
      error: error.message,
    });
  }
}
