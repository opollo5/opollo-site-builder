import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

/**
 * Reads cap_campaign_posts for the company over the last 90 days.
 * Aggregates patterns from rejection_reason + regenerate_count > 0.
 * Upserts ins_client_memory rows with memory_type='edit_pattern'.
 */
export async function aggregateEditPatterns(companyId: string): Promise<number> {
  const svc = getServiceRoleClient();

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: editedPosts } = await svc
    .from("cap_campaign_posts")
    .select("id, rejection_reason, regenerate_count")
    .eq("company_id", companyId)
    .gte("created_at", cutoff)
    .gt("regenerate_count", 0);

  if (!editedPosts || editedPosts.length < 5) {
    return 0;
  }

  const reasonCounts = new Map<string, number>();
  for (const post of editedPosts) {
    if (post.rejection_reason) {
      const normalized = normalizeRejectionReason(post.rejection_reason);
      reasonCounts.set(normalized, (reasonCounts.get(normalized) ?? 0) + 1);
    }
  }

  let patternsWritten = 0;
  const now = new Date().toISOString();

  for (const [pattern, count] of reasonCounts.entries()) {
    if (count >= 3) {
      // Upsert on (company_id, memory_type, payload->>'pattern') via the unique index
      // We insert with a conflict target on the computed column
      const { error } = await svc.from("ins_client_memory").upsert(
        {
          company_id: companyId,
          memory_type: "edit_pattern" as const,
          payload: {
            pattern,
            occurrence_count: count,
            confidence: count / editedPosts.length,
          },
          last_observed_at: now,
        },
        {
          onConflict: "company_id,memory_type",
          ignoreDuplicates: false,
        },
      );

      if (!error) patternsWritten++;
    }
  }

  return patternsWritten;
}

function normalizeRejectionReason(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
