// Module-private types for the optimiser. Shared across data-ingestion,
// scoring, proposals, and review UI. Slice-by-slice files import from
// here rather than redefining shapes.

export type OptHostingMode =
  | "opollo_subdomain"
  | "opollo_cname"
  | "client_slice";

export type OptCredentialSource =
  | "google_ads"
  | "clarity"
  | "ga4"
  | "pagespeed";

export type OptCredentialStatus =
  | "connected"
  | "expired"
  | "misconfigured"
  | "disconnected";

export type OptManagementMode = "read_only" | "full_automation";

export type OptPageState =
  | "active"
  | "healthy"
  | "insufficient_data"
  | "read_only_external";

export type OptDataReliability = "green" | "amber" | "red";

export type OptProposalCategory = "content_fix" | "technical_alert";

export type OptProposalStatus =
  | "draft"
  | "pending"
  | "approved"
  | "applied"
  | "applied_promoted"
  | "applied_then_reverted"
  | "rejected"
  | "expired";

export type OptRiskLevel = "low" | "medium" | "high";

export type OptPlaybookCategory = "content_fix" | "technical_alert";

export type OptMemoryType =
  | "rejected_pattern"
  | "winning_variant"
  | "preference";

// §12.2.1 staged-rollout config shape baked into opt_clients.
export type StagedRolloutConfig = {
  initial_traffic_split_percent: number;
  minimum_sessions: number;
  minimum_conversions: number;
  minimum_time_hours: number;
  cr_drop_rollback_pct: number;
  cr_drop_significance: number;
  bounce_spike_rollback_pct: number;
  error_spike_rollback_rate: number;
  maximum_window_days: number;
};

export const DEFAULT_STAGED_ROLLOUT_CONFIG: StagedRolloutConfig = {
  initial_traffic_split_percent: 20,
  minimum_sessions: 300,
  minimum_conversions: 10,
  minimum_time_hours: 48,
  cr_drop_rollback_pct: 15,
  cr_drop_significance: 0.9,
  bounce_spike_rollback_pct: 25,
  error_spike_rollback_rate: 0.01,
  maximum_window_days: 7,
};
