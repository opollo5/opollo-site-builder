import { NextResponse, type NextRequest } from "next/server";
import { Client } from "pg";

import { getServiceRoleClient } from "@/lib/supabase";
import { requireDbConfig } from "@/lib/db-direct";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { publishPost } from "@/lib/social/publishing/bundle-social-client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 5;
const MAX_PUBLISH_ATTEMPTS = 3;
const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// POST /api/internal/cron/publish-due
// Schedule: * * * * * (every minute)
//
// Picks up state='scheduled' drafts with scheduled_at <= NOW(), atomically
// claims them via FOR UPDATE SKIP LOCKED (transition state→'publishing'
// inside the locked row set), then publishes to bundle.social in parallel
// with concurrency=5.
//
// Concurrency safety: the SELECT FOR UPDATE SKIP LOCKED + UPDATE happens in
// a single SQL statement (CTE form). Two cron ticks that overlap (when a
// tick exceeds 60s, or when a manual trigger races the schedule) see
// disjoint row sets — duplicate billed publishes to bundle.social are
// impossible. Pattern matches lib/brief-runner.ts:286-318.
// ---------------------------------------------------------------------------

interface ClaimedDraft {
  id: string;
  company_id: string;
  content: string;
  media_urls: string[] | null;
  target_profiles: Array<{ profile_id: string }> | null;
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }> | null;
  publish_attempts: number | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const workerId = `publish-due-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${process.pid}`;
  let candidates: ClaimedDraft[];

  // 1. Atomic claim phase — direct pg.Client for FOR UPDATE SKIP LOCKED.
  const pg = new Client(requireDbConfig());
  try {
    await pg.connect();
    candidates = await claimDueDrafts(pg, workerId);
  } catch (err) {
    logger.error("publish_due.claim_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    await updateHeartbeat("publish-due", "error", err instanceof Error ? err : new Error(String(err)));
    await pg.end().catch(() => {});
    return NextResponse.json({ ok: false, error: "claim_failed" }, { status: 500 });
  } finally {
    await pg.end().catch(() => {});
  }

  if (candidates.length === 0) {
    await updateHeartbeat("publish-due", "ok");
    return NextResponse.json({
      ok: true,
      data: { processed: 0, succeeded: 0, failed: 0 },
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Publish phase — bundle.social calls + result writeback via PostgREST.
  const svc = getServiceRoleClient();
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (draft) => {
        try {
          const targetProfileIds = (draft.target_profiles ?? []).map((p) => p.profile_id);
          const result = await publishPost({
            externalPostId: draft.id,
            content: draft.content,
            mediaUrls: draft.media_urls ?? [],
            targetProfileIds,
            platformVariants: draft.platform_variants ?? {},
          });

          await svc
            .from("social_post_drafts")
            .update({
              state: "published",
              published_at: new Date().toISOString(),
              published_url: result.publishedUrl ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", draft.id);

          succeeded++;
        } catch (err) {
          const attempts = (draft.publish_attempts ?? 0) + 1;
          const newState = attempts >= MAX_PUBLISH_ATTEMPTS ? "failed" : "scheduled";

          await svc
            .from("social_post_drafts")
            .update({
              state: newState,
              publish_attempts: attempts,
              // Clear the claim so a retry tick can re-claim if the row
              // reverted to 'scheduled'. Leaving publish_claimed_at set
              // would otherwise stamp the row as "in flight" forever for
              // diagnostics-only consumers.
              publish_claimed_at: null,
              publish_worker_id: null,
              last_publish_error: {
                code: "PUBLISH_FAILED",
                message: err instanceof Error ? err.message : String(err),
                attempted_at: new Date().toISOString(),
                attempt_number: attempts,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", draft.id);

          logger.warn("publish_due.draft_failed", {
            draftId: draft.id,
            attempts,
            err: err instanceof Error ? err.message : String(err),
          });
          failed++;
        }
      }),
    );
  }

  await updateHeartbeat("publish-due", "ok");
  logger.info("publish_due.tick", { processed: candidates.length, succeeded, failed });

  return NextResponse.json({
    ok: true,
    data: { processed: candidates.length, succeeded, failed },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// claimDueDrafts — atomic claim of up to BATCH_SIZE due drafts.
//
// Single SQL statement: CTE locks candidates with FOR UPDATE SKIP LOCKED,
// outer UPDATE transitions them to 'publishing' and stamps claim metadata.
// The lock is held until the implicit transaction commits at statement
// end — concurrent ticks see disjoint row sets.
//
// MAX_PUBLISH_ATTEMPTS gates retry exhaustion: drafts at the cap are NOT
// re-claimed (matches the prior SELECT's .lt("publish_attempts", MAX) filter).
// ---------------------------------------------------------------------------
export async function claimDueDrafts(
  client: Client,
  workerId: string,
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
    [MAX_PUBLISH_ATTEMPTS, BATCH_SIZE, workerId],
  );
  return res.rows;
}
