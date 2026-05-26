import type { Client } from "pg";

// ---------------------------------------------------------------------------
// claimDueDrafts — atomic claim of up to batchSize due drafts.
//
// Single SQL statement: a CTE locks candidates with FOR UPDATE SKIP LOCKED,
// the outer UPDATE transitions them to 'publishing' and stamps claim
// metadata. The lock is held until the implicit transaction commits at
// statement end — concurrent ticks see disjoint row sets.
//
// Mirrors lib/brief-runner.ts:286-318 (FOR UPDATE SKIP LOCKED + CAS) but
// claims a BATCH rather than a single row, because the publish cron
// processes up to BATCH_SIZE drafts per tick.
// ---------------------------------------------------------------------------

export interface ClaimedDraft {
  id: string;
  company_id: string;
  content: string;
  media_urls: string[] | null;
  target_profiles: Array<{ profile_id: string }> | null;
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }> | null;
  publish_attempts: number | null;
}

export async function claimDueDrafts(
  client: Client,
  workerId: string,
  opts: { maxAttempts: number; batchSize: number },
): Promise<ClaimedDraft[]> {
  const res = await client.query<ClaimedDraft>(
    `
    WITH claimed AS (
      SELECT id
        FROM social_post_drafts
       WHERE state = 'scheduled'
         AND scheduled_at <= now()
         AND publish_attempts < $1
         AND archived_at IS NULL
       ORDER BY scheduled_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
    )
    UPDATE social_post_drafts d
       SET state = 'publishing',
           publish_claimed_at = now(),
           publish_worker_id = $3,
           updated_at = now()
      FROM claimed
     WHERE d.id = claimed.id
    RETURNING d.id, d.company_id, d.content, d.media_urls,
              d.target_profiles, d.platform_variants, d.publish_attempts
    `,
    [opts.maxAttempts, opts.batchSize, workerId],
  );
  return res.rows;
}
