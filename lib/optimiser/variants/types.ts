// Shared types for the Phase 2 A/B testing system.

export type VariantLabel = "A" | "B" | "C" | "D";

export type VariantStatus =
  | "queued"
  | "generating"
  | "ready"
  | "active"
  | "superseded"
  | "failed";

export type TestStatus =
  | "queued"
  | "running"
  | "winner_a"
  | "winner_b"
  | "inconclusive"
  | "stopped";

export interface VariantRow {
  id: string;
  client_id: string;
  landing_page_id: string;
  source_proposal_id: string;
  variant_label: VariantLabel;
  brief_id: string | null;
  brief_run_id: string | null;
  page_version: string | null;
  change_set: Record<string, unknown>;
  generation_notes: string | null;
  status: VariantStatus;
  generated_at: string | null;
  failed_reason: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface TestRow {
  id: string;
  client_id: string;
  landing_page_id: string;
  source_proposal_id: string;
  variant_a_id: string;
  variant_b_id: string;
  traffic_split_percent: number;
  status: TestStatus;
  min_sessions: number;
  min_conversions: number;
  winner_probability_a: number | null;
  winner_probability_b: number | null;
  last_metrics_snapshot: Record<string, unknown>;
  last_evaluated_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  ended_reason: string | null;
  created_at: string;
  updated_at: string;
}
