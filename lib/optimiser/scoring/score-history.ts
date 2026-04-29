import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { ScoreClassification, ScoreWeights } from "./types";

// Score-history reader — powers the sparkline + version timeline (§4.2).

export type ScoreHistoryRow = {
  id: string;
  client_id: string;
  landing_page_id: string;
  page_version: string | null;
  composite_score: number;
  classification: ScoreClassification;
  alignment_subscore: number | null;
  behaviour_subscore: number | null;
  conversion_subscore: number | null;
  technical_subscore: number | null;
  weights_used: ScoreWeights;
  confidence: number | null;
  triggering_proposal_id: string | null;
  change_set_summary: string | null;
  evaluated_at: string;
  created_at: string;
};

const COLS =
  "id, client_id, landing_page_id, page_version, composite_score, classification, alignment_subscore, behaviour_subscore, conversion_subscore, technical_subscore, weights_used, confidence, triggering_proposal_id, change_set_summary, evaluated_at, created_at";

export async function listScoreHistory(args: {
  landingPageId: string;
  limit?: number;
}): Promise<ScoreHistoryRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_page_score_history")
    .select(COLS)
    .eq("landing_page_id", args.landingPageId)
    .order("evaluated_at", { ascending: false })
    .limit(args.limit ?? 50);
  if (error) throw new Error(`listScoreHistory: ${error.message}`);
  return (data ?? []) as ScoreHistoryRow[];
}

/**
 * Return the last N rows ordered ASC by evaluated_at — the shape the
 * sparkline component expects. Limit is capped at 50.
 */
export async function listScoreSparkline(args: {
  landingPageId: string;
  limit?: number;
}): Promise<ScoreHistoryRow[]> {
  const rows = await listScoreHistory({
    landingPageId: args.landingPageId,
    limit: Math.min(args.limit ?? 10, 50),
  });
  return rows.slice().reverse();
}
