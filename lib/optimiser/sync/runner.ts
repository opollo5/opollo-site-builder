import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { markCredentialError, markCredentialSynced } from "../credentials";
import type { OptCredentialSource } from "../types";

// ---------------------------------------------------------------------------
// Shared sync runner.
//
// Each cron tick (POST /api/cron/optimiser-sync-*) routes here. The
// runner enumerates clients with a `connected` credential row for the
// given source and fans out per-client sync calls. Per-client failure
// is isolated: a 401 / 403 from one client's API call doesn't prevent
// the next from running. The credential's status is flipped on auth
// failure so the §7.3 banner surfaces correctly.
//
// Shape mirrors the existing /api/cron/process-batch fan-out — small,
// fast, idempotent, safe to run on a `* * * * *` schedule even when
// the per-client work isn't due yet (each per-client implementation
// short-circuits if it ran recently enough — that contract lives in
// the per-source sync function).
// ---------------------------------------------------------------------------

export type SyncOutcome = {
  client_id: string;
  source: OptCredentialSource;
  result: "ok" | "skipped" | "auth_error" | "error";
  duration_ms: number;
  rows_written?: number;
  error?: string;
  error_code?: string;
};

export type SyncFn = (clientId: string) => Promise<{
  rows_written: number;
  skipped?: boolean;
  /** Optional per-client cache of last-synced — if provided, the runner
   * uses it to short-circuit before invoking the sync. */
}>;

export class CredentialAuthError extends Error {
  constructor(
    public readonly code: "EXPIRED" | "MISCONFIGURED" | "DISCONNECTED",
    message: string,
  ) {
    super(message);
    this.name = "CredentialAuthError";
  }
}

/** List clients with connected credentials for a source. */
export async function listConnectedClients(
  source: OptCredentialSource,
): Promise<string[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_credentials")
    .select("client_id")
    .eq("source", source)
    .eq("status", "connected");
  if (error) {
    throw new Error(
      `listConnectedClients(${source}): ${error.message}`,
    );
  }
  return (data ?? []).map((r) => r.client_id as string);
}

/**
 * Run `syncFn(clientId)` for every connected client, capture outcomes,
 * never throw. Authentication failures flip the credential row's status
 * via markCredentialError; non-auth errors leave status = connected
 * but log + record the outcome.
 */
export async function runSyncForAllClients(
  source: OptCredentialSource,
  syncFn: SyncFn,
): Promise<{ outcomes: SyncOutcome[]; total: number }> {
  let clientIds: string[];
  try {
    clientIds = await listConnectedClients(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("optimiser.sync.list_clients_failed", { source, error: message });
    return { outcomes: [], total: 0 };
  }

  const outcomes: SyncOutcome[] = [];
  for (const clientId of clientIds) {
    const start = Date.now();
    try {
      const res = await syncFn(clientId);
      const duration_ms = Date.now() - start;
      if (res.skipped) {
        outcomes.push({
          client_id: clientId,
          source,
          result: "skipped",
          duration_ms,
          rows_written: 0,
        });
        continue;
      }
      await markCredentialSynced(clientId, source);
      outcomes.push({
        client_id: clientId,
        source,
        result: "ok",
        duration_ms,
        rows_written: res.rows_written,
      });
    } catch (err) {
      const duration_ms = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof CredentialAuthError) {
        const status =
          err.code === "EXPIRED"
            ? "expired"
            : err.code === "DISCONNECTED"
              ? "disconnected"
              : "misconfigured";
        await markCredentialError(clientId, source, status, err.code, message);
        outcomes.push({
          client_id: clientId,
          source,
          result: "auth_error",
          duration_ms,
          error: message,
          error_code: err.code,
        });
        logger.warn("optimiser.sync.auth_error", {
          client_id: clientId,
          source,
          code: err.code,
        });
      } else {
        outcomes.push({
          client_id: clientId,
          source,
          result: "error",
          duration_ms,
          error: message,
        });
        logger.error("optimiser.sync.failed", {
          client_id: clientId,
          source,
          error: message,
        });
      }
    }
  }
  return { outcomes, total: clientIds.length };
}
