// Re-export hub for the optimiser module. Slices add re-exports here as
// they ship their public surface.

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

// Slice 3 surface
export {
  listClients,
  getClient,
  createClient as createOptClient,
  updateClient as updateOptClient,
  markOnboarded,
} from "./clients";
export type { OptClient, CreateClientInput, UpdateClientInput } from "./clients";

export {
  getConnectorStatus,
  bannerForConnector,
} from "./connector-status";
export type {
  ConnectorStatus,
  ConnectorBanner,
  ConnectorBannerKind,
} from "./connector-status";

export { verifyAds, verifyClarity, verifyGa4 } from "./verify-connector";
export type { VerifyResult } from "./verify-connector";

export {
  listLandingPagesForClient,
  getLandingPage,
  defaultCheckedForBulk,
  setManagedFlag,
  addPageManually,
} from "./landing-pages";
export type { LandingPage } from "./landing-pages";

export { planPageImport } from "./page-import";
export type { ImportPlan } from "./page-import";
