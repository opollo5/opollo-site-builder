import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// Reader for the causal-delta UI surfaces (§4.3).

export type CausalDeltaRow = {
  id: string;
  client_id: string;
  landing_page_id: string;
  proposal_id: string;
  change_set: Record<string, unknown>;
  expected_impact: { min_pp?: number | null; max_pp?: number | null };
  actual_impact_cr: number | null;
  actual_impact_score: number | null;
  confidence_score: number | null;
  triggering_playbook_id: string | null;
  evaluation_window_start: string;
  evaluation_window_end: string;
  created_at: string;
};

const COLS =
  "id, client_id, landing_page_id, proposal_id, change_set, expected_impact, actual_impact_cr, actual_impact_score, confidence_score, triggering_playbook_id, evaluation_window_start, evaluation_window_end, created_at";

export async function listCausalDeltasForPage(
  landingPageId: string,
): Promise<CausalDeltaRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_causal_deltas")
    .select(COLS)
    .eq("landing_page_id", landingPageId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listCausalDeltasForPage: ${error.message}`);
  return (data ?? []) as CausalDeltaRow[];
}

/**
 * Read the most recent N causal deltas for a (client, playbook)
 * combination. Powers the proposal-review "what happened last time
 * we did this" panel.
 */
export async function listRecentCausalDeltasForPlaybook(args: {
  clientId: string;
  playbookId: string;
  limit?: number;
}): Promise<CausalDeltaRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_causal_deltas")
    .select(COLS)
    .eq("client_id", args.clientId)
    .eq("triggering_playbook_id", args.playbookId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 5);
  if (error)
    throw new Error(`listRecentCausalDeltasForPlaybook: ${error.message}`);
  return (data ?? []) as CausalDeltaRow[];
}

/** Build the proposal-id → delta map the score-history table consumes. */
export function buildDeltaMapByProposal(
  deltas: CausalDeltaRow[],
): Map<
  string,
  { actual_impact_cr?: number | null; actual_impact_score?: number | null; confidence_score?: number | null }
> {
  const map = new Map();
  for (const d of deltas) {
    map.set(d.proposal_id, {
      actual_impact_cr: d.actual_impact_cr,
      actual_impact_score: d.actual_impact_score,
      confidence_score: d.confidence_score,
    });
  }
  return map;
}

/**
 * Aggregate the past N deltas for a playbook into a single summary
 * line: "past 3 CTA-move proposals for this client averaged +1.4% CR
 * with high confidence".
 */
export function summariseDeltasForReviewPanel(
  deltas: CausalDeltaRow[],
): {
  count: number;
  avg_cr_pct: number | null;
  avg_score_delta: number | null;
  avg_confidence: number | null;
} {
  if (deltas.length === 0) {
    return {
      count: 0,
      avg_cr_pct: null,
      avg_score_delta: null,
      avg_confidence: null,
    };
  }
  const crs = deltas
    .map((d) => d.actual_impact_cr)
    .filter((v): v is number => v != null);
  const scores = deltas
    .map((d) => d.actual_impact_score)
    .filter((v): v is number => v != null);
  const confs = deltas
    .map((d) => d.confidence_score)
    .filter((v): v is number => v != null);
  return {
    count: deltas.length,
    avg_cr_pct: crs.length > 0 ? crs.reduce((a, b) => a + b, 0) / crs.length : null,
    avg_score_delta:
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    avg_confidence:
      confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
  };
}
