import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Per-client memory (spec §11.1).
//
// Three patterns:
//   1. rejected_pattern — bump count on every rejection. Suppression
//      fires when count ≥ 3 with the SAME reason for the same
//      (playbook, page_type) combo. Reason 'bad_timing' is excluded
//      from suppression counting (spec §11.1 v1.3 refinement).
//   2. winning_variant — Phase 2 placeholder. The schema is in place;
//      the writer lands when A/B tests resolve.
//   3. preference — design feedback (component / tone / density). Slice
//      6 doesn't auto-derive these; staff add via the client settings
//      surface (Phase 1.5 polish).
//
// suppressedPlaybooksFor(clientId) returns the Set the proposal-
// generation skill consumes to short-circuit suppressed playbooks.
// ---------------------------------------------------------------------------

const SUPPRESSION_THRESHOLD = 3;
const SUPPRESSION_EXEMPT_REASONS = new Set(["bad_timing"]);

export type RejectionReason =
  | "not_aligned_brand"
  | "offer_change_not_approved"
  | "bad_timing"
  | "design_conflict"
  | "other";

/**
 * Bump the (rejected_pattern, playbook+page+reason) row by one. Returns
 * TRUE if this rejection is the one that flips the (playbook, page) pair
 * into the suppressed state for this client.
 */
export async function recordRejection(args: {
  clientId: string;
  playbookId: string;
  reasonCode: RejectionReason;
  pageType: string;
  userId: string | null;
}): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const key = `${args.playbookId}:${args.pageType}:${args.reasonCode}`;
  // Atomic-ish: SELECT current count, UPDATE+RETURNING. Two writers
  // racing here may double-bump; that's OK — the suppression
  // threshold of 3 absorbs minor over-counting and the row is
  // user-correctable from settings.
  const { data: existing } = await supabase
    .from("opt_client_memory")
    .select("id, count")
    .eq("client_id", args.clientId)
    .eq("memory_type", "rejected_pattern")
    .eq("key", key)
    .maybeSingle();

  const nextCount = (existing?.count ?? 0) + 1;
  if (existing) {
    await supabase
      .from("opt_client_memory")
      .update({
        count: nextCount,
        payload: {
          playbook_id: args.playbookId,
          page_type: args.pageType,
          reason_code: args.reasonCode,
          last_rejected_at: new Date().toISOString(),
        },
        cleared: false,
        updated_by: args.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
  } else {
    await supabase.from("opt_client_memory").insert({
      client_id: args.clientId,
      memory_type: "rejected_pattern",
      key,
      count: 1,
      payload: {
        playbook_id: args.playbookId,
        page_type: args.pageType,
        reason_code: args.reasonCode,
        last_rejected_at: new Date().toISOString(),
      },
      updated_by: args.userId,
    });
  }

  if (SUPPRESSION_EXEMPT_REASONS.has(args.reasonCode)) {
    // 'bad_timing' rejections never count toward suppression.
    return false;
  }
  return nextCount === SUPPRESSION_THRESHOLD;
}

/**
 * Compute the per-client set of suppressed playbook ids based on
 * §11.1 reason-gated suppression. A (playbook, page_type) pair is
 * suppressed when at least one (reason_code != 'bad_timing') row has
 * count ≥ 3 and not cleared.
 *
 * Phase 1 returns the Set keyed by playbook_id only (one page_type
 * value, 'landing'). When Phase 2 introduces other shapes, return
 * Set<`${playbook_id}:${page_type}`> and update the score-pages job.
 */
export async function suppressedPlaybooksFor(
  clientId: string,
): Promise<Set<string>> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_memory")
    .select("key, count, cleared")
    .eq("client_id", clientId)
    .eq("memory_type", "rejected_pattern");
  if (error) {
    logger.error("optimiser.client_memory.list_failed", {
      client_id: clientId,
      error: error.message,
    });
    return new Set();
  }
  const out = new Set<string>();
  for (const row of data ?? []) {
    if (row.cleared) continue;
    if ((row.count as number) < SUPPRESSION_THRESHOLD) continue;
    const parts = (row.key as string).split(":");
    const [playbookId, , reasonCode] = parts;
    if (SUPPRESSION_EXEMPT_REASONS.has(reasonCode)) continue;
    out.add(playbookId);
  }
  return out;
}

export type ClientMemoryRow = {
  id: string;
  memory_type: "rejected_pattern" | "winning_variant" | "preference";
  key: string;
  count: number;
  cleared: boolean;
  payload: Record<string, unknown>;
  updated_at: string;
};

export async function listClientMemory(
  clientId: string,
): Promise<ClientMemoryRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_client_memory")
    .select("id, memory_type, key, count, cleared, payload, updated_at")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listClientMemory: ${error.message}`);
  return (data ?? []) as ClientMemoryRow[];
}

/** Staff override: clear (or un-clear) a memory entry. */
export async function setMemoryCleared(
  id: string,
  cleared: boolean,
  userId: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("opt_client_memory")
    .update({
      cleared,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`setMemoryCleared: ${error.message}`);
}
