import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { isPatternLibraryEnabled } from "./pattern-library/feature-flag";
import type { OptCredentialSource } from "./types";

// ---------------------------------------------------------------------------
// Operator diagnostics for the optimiser module. Slice 10 surface — the
// "is this thing wired up correctly" check that runs after each
// credential is provisioned.
//
// Reports four things per data source:
//   1. Whether the env vars the source needs are set
//   2. Whether at least one client has connected credentials for it
//   3. Whether a successful sync has happened in the last 24h
//   4. Whether the most recent sync attempt errored (with the error code)
//
// Plus module-wide checks: schema reachable, LLM key set, master key set.
// ---------------------------------------------------------------------------

export type EnvCheck = {
  name: string;
  required: string[];
  optional?: string[];
  /** TRUE if every required var is set (non-empty). */
  configured: boolean;
  /** Names of required vars that are missing. */
  missing: string[];
};

export type SourceDiagnostic = {
  source: OptCredentialSource | "anthropic";
  env: EnvCheck;
  /** Number of clients with status='connected' for this source.
   * Anthropic + system entries leave this 0 — they're not per-client. */
  connected_clients: number;
  /** Most-recent successful sync across all clients. */
  last_successful_sync_at: string | null;
  /** Most-recent error across all clients. */
  last_error: { code: string; message: string; at: string } | null;
  /** Number of clients whose status is currently 'expired' /
   * 'misconfigured' / 'disconnected'. */
  clients_in_error: number;
};

export type ModuleDiagnostic = {
  schema_reachable: boolean;
  schema_error?: string;
  master_key_set: boolean;
  cron_secret_set: boolean;
  email_provider: string;
  client_count: number;
  onboarded_count: number;
};

// Phase 3 Slice 24 — pattern library state for the diagnostics surface.
// Reports whether the feature flag is on, how many clients consent
// (contribution + application gate per §11.2.2), how many pattern rows
// have been extracted, and when the most recent extraction ran. The
// breakdown by confidence helps the operator see whether the cohort is
// large enough to be useful — patterns at "low" confidence dominate
// until the consenting-client pool grows past ~5.
export type PatternLibraryDiagnostic = {
  feature_flag_enabled: boolean;
  consenting_client_count: number;
  pattern_count: number;
  pattern_by_confidence: { high: number; moderate: number; low: number };
  last_extracted_at: string | null;
};

// Phase 1.5 follow-up slice D — 5xx feed from Vercel logs. Reports
// whether the env vars are configured, when the last sync wrote rows,
// and how many landing pages saw 5xx in the most recent window. The
// staged-rollout monitor's error_rate threshold is dormant when this
// feed is unconfigured — operators rely on the diagnostic to know.
export type ServerErrorFeedDiagnostic = {
  env_configured: boolean;
  missing: string[];
  last_synced_at: string | null;
  pages_with_errors_24h: number;
  total_5xx_24h: number;
};

export type DiagnosticsReport = {
  module: ModuleDiagnostic;
  sources: SourceDiagnostic[];
  pattern_library: PatternLibraryDiagnostic;
  server_error_feed: ServerErrorFeedDiagnostic;
  generated_at: string;
};

const SOURCE_ENV: Record<
  OptCredentialSource | "anthropic",
  { required: string[]; optional?: string[] }
> = {
  google_ads: {
    required: [
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_DEVELOPER_TOKEN",
    ],
  },
  ga4: {
    required: ["GA4_CLIENT_ID", "GA4_CLIENT_SECRET"],
    optional: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  },
  clarity: {
    // Clarity uses per-client tokens; no Opollo-wide env needed.
    required: [],
  },
  pagespeed: {
    required: ["PAGESPEED_API_KEY"],
  },
  anthropic: {
    required: ["ANTHROPIC_API_KEY"],
  },
};

function checkEnv(source: OptCredentialSource | "anthropic"): EnvCheck {
  const cfg = SOURCE_ENV[source];
  const missing: string[] = [];
  for (const key of cfg.required) {
    const v = process.env[key];
    if (!v || v.trim().length === 0) missing.push(key);
  }
  // For GA4, accept the GOOGLE_OAUTH_* fallback pair as a substitute.
  if (source === "ga4" && missing.length === cfg.required.length) {
    const fallback = (cfg.optional ?? []).every(
      (k) => (process.env[k] ?? "").trim().length > 0,
    );
    if (fallback) {
      return {
        name: source,
        required: cfg.required,
        optional: cfg.optional,
        configured: true,
        missing: [],
      };
    }
  }
  return {
    name: source,
    required: cfg.required,
    optional: cfg.optional,
    configured: missing.length === 0,
    missing,
  };
}

export async function runDiagnostics(): Promise<DiagnosticsReport> {
  const supabase = getServiceRoleClient();

  let schemaReachable = true;
  let schemaError: string | undefined;
  let clientCount = 0;
  let onboardedCount = 0;
  try {
    const { data, error, count } = await supabase
      .from("opt_clients")
      .select("id, onboarded_at", { count: "exact" })
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    clientCount = count ?? (data?.length ?? 0);
    onboardedCount = (data ?? []).filter((r) => r.onboarded_at).length;
  } catch (err) {
    schemaReachable = false;
    schemaError = err instanceof Error ? err.message : String(err);
  }

  const sources: SourceDiagnostic[] = [];
  const sourceList: Array<OptCredentialSource | "anthropic"> = [
    "google_ads",
    "ga4",
    "clarity",
    "pagespeed",
    "anthropic",
  ];
  for (const source of sourceList) {
    sources.push(await diagnoseSource(source));
  }

  const patternLibrary = await diagnosePatternLibrary(schemaReachable);
  const serverErrorFeed = await diagnoseServerErrorFeed(schemaReachable);

  return {
    module: {
      schema_reachable: schemaReachable,
      schema_error: schemaError,
      master_key_set:
        (process.env.OPOLLO_MASTER_KEY ?? "").trim().length > 0,
      cron_secret_set:
        (process.env.CRON_SECRET ?? "").trim().length >= 16,
      email_provider:
        process.env.OPTIMISER_EMAIL_PROVIDER?.trim() || "noop",
      client_count: clientCount,
      onboarded_count: onboardedCount,
    },
    sources,
    pattern_library: patternLibrary,
    server_error_feed: serverErrorFeed,
    generated_at: new Date().toISOString(),
  };
}

async function diagnoseServerErrorFeed(
  schemaReachable: boolean,
): Promise<ServerErrorFeedDiagnostic> {
  const required = ["VERCEL_API_TOKEN", "VERCEL_PROJECT_ID"];
  const missing = required.filter(
    (k) => (process.env[k] ?? "").trim().length === 0,
  );
  const envConfigured = missing.length === 0;
  if (!schemaReachable) {
    return {
      env_configured: envConfigured,
      missing,
      last_synced_at: null,
      pages_with_errors_24h: 0,
      total_5xx_24h: 0,
    };
  }
  const supabase = getServiceRoleClient();
  let lastSyncedAt: string | null = null;
  let pagesWithErrors = 0;
  let total5xx = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data } = await supabase
      .from("opt_metrics_daily")
      .select("metrics, ingested_at")
      .eq("source", "server_errors")
      .in("metric_date", [today, yesterday]);
    for (const row of data ?? []) {
      const m = (row.metrics ?? {}) as Record<string, unknown>;
      const errs = typeof m.errors_5xx === "number" ? m.errors_5xx : 0;
      if (errs > 0) pagesWithErrors += 1;
      total5xx += errs;
      const at = row.ingested_at as string | null;
      if (at && (!lastSyncedAt || at > lastSyncedAt)) lastSyncedAt = at;
    }
  } catch {
    // Best-effort.
  }
  return {
    env_configured: envConfigured,
    missing,
    last_synced_at: lastSyncedAt,
    pages_with_errors_24h: pagesWithErrors,
    total_5xx_24h: total5xx,
  };
}

async function diagnosePatternLibrary(
  schemaReachable: boolean,
): Promise<PatternLibraryDiagnostic> {
  const flagEnabled = isPatternLibraryEnabled();
  if (!schemaReachable) {
    return {
      feature_flag_enabled: flagEnabled,
      consenting_client_count: 0,
      pattern_count: 0,
      pattern_by_confidence: { high: 0, moderate: 0, low: 0 },
      last_extracted_at: null,
    };
  }
  const supabase = getServiceRoleClient();
  let consenting = 0;
  let total = 0;
  const byConf = { high: 0, moderate: 0, low: 0 };
  let lastExtractedAt: string | null = null;
  try {
    const { count: cConsent } = await supabase
      .from("opt_clients")
      .select("id", { count: "exact", head: true })
      .eq("cross_client_learning_consent", true)
      .is("deleted_at", null);
    consenting = cConsent ?? 0;
    const { data: patterns } = await supabase
      .from("opt_pattern_library")
      .select("id, confidence, last_extracted_at");
    for (const row of patterns ?? []) {
      total += 1;
      const conf = row.confidence as keyof typeof byConf;
      if (conf in byConf) byConf[conf] += 1;
      const at = row.last_extracted_at as string | null;
      if (at && (!lastExtractedAt || at > lastExtractedAt)) {
        lastExtractedAt = at;
      }
    }
  } catch {
    // Best-effort; surface zeros if the read fails.
  }
  return {
    feature_flag_enabled: flagEnabled,
    consenting_client_count: consenting,
    pattern_count: total,
    pattern_by_confidence: byConf,
    last_extracted_at: lastExtractedAt,
  };
}

async function diagnoseSource(
  source: OptCredentialSource | "anthropic",
): Promise<SourceDiagnostic> {
  const env = checkEnv(source);
  if (source === "anthropic") {
    return {
      source,
      env,
      connected_clients: 0,
      last_successful_sync_at: null,
      last_error: null,
      clients_in_error: 0,
    };
  }

  const supabase = getServiceRoleClient();
  let connectedClients = 0;
  let clientsInError = 0;
  let lastSuccessfulSyncAt: string | null = null;
  let lastError: SourceDiagnostic["last_error"] = null;

  try {
    const { data } = await supabase
      .from("opt_client_credentials")
      .select(
        "status, last_synced_at, last_attempted_at, last_error_code, last_error_message",
      )
      .eq("source", source);
    for (const row of data ?? []) {
      if (row.status === "connected") connectedClients += 1;
      else clientsInError += 1;
      if (
        row.last_synced_at &&
        (!lastSuccessfulSyncAt ||
          (row.last_synced_at as string) > lastSuccessfulSyncAt)
      ) {
        lastSuccessfulSyncAt = row.last_synced_at as string;
      }
      if (
        row.last_error_code &&
        row.last_attempted_at &&
        (!lastError || (row.last_attempted_at as string) > lastError.at)
      ) {
        lastError = {
          code: row.last_error_code as string,
          message: (row.last_error_message as string | null) ?? "",
          at: row.last_attempted_at as string,
        };
      }
    }
  } catch {
    // Schema unreachable — module diagnostic already captures the
    // root cause; per-source fields stay zero.
  }

  return {
    source,
    env,
    connected_clients: connectedClients,
    last_successful_sync_at: lastSuccessfulSyncAt,
    last_error: lastError,
    clients_in_error: clientsInError,
  };
}
