// Re-export hub for the optimiser module. Slices add re-exports here as
// they ship their public surface. Keep imports in app/optimiser and
// app/api/optimiser routed through "@/lib/optimiser" rather than deep
// paths so the module's internal layout can change without churn.

export * from "./types";
export { checkOptimiserSchema } from "./health";

// Slice 2 surface
export {
  upsertCredential,
  getCredentialMeta,
  readCredential,
  markCredentialError,
  markCredentialSynced,
} from "./credentials";
export type { StoredCredential, DecryptedSecret } from "./credentials";

export { checkBudget, recordLlmCall, gateLlmCall } from "./llm-usage";
export type { BudgetCheckResult, RecordLlmCallArgs } from "./llm-usage";

export { runSyncForAllClients, CredentialAuthError } from "./sync/runner";
export type { SyncOutcome, SyncFn } from "./sync/runner";

export { syncAdsForClient } from "./sync/ads";
export { syncClarityForClient } from "./sync/clarity";
export { syncGa4ForClient } from "./sync/ga4";
export { syncPagespeedForClient } from "./sync/pagespeed";

export {
  signState,
  verifyState,
  adsConsentUrl,
  ga4ConsentUrl,
  exchangeCodeForRefreshToken,
} from "./oauth";
export type { OAuthSource, OAuthState } from "./oauth";
