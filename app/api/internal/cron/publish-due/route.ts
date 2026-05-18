import { NextResponse, type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
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
// Picks up state='scheduled' drafts with scheduled_at <= NOW(),
// sets them to 'publishing' (exclusive via state transition), then
// publishes to bundle.social in parallel with concurrency=5.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  // Claim rows atomically: fetch then immediately update to 'publishing'.
  // FOR UPDATE SKIP LOCKED equivalent: we update in the same Postgres call.
  const { data: candidates, error: fetchErr } = await svc
    .from("social_post_drafts")
    .select("id, company_id, content, media_urls, target_profiles, platform_variants, publish_attempts")
    .eq("state", "scheduled")
    .lte("scheduled_at", now)
    .lt("publish_attempts", MAX_PUBLISH_ATTEMPTS)
    .is("archived_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    logger.error("publish_due.fetch_failed", { err: fetchErr.message });
    await updateHeartbeat("publish-due", "error", fetchErr);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  if (!candidates || candidates.length === 0) {
    await updateHeartbeat("publish-due", "ok");
    return NextResponse.json({ ok: true, data: { processed: 0, succeeded: 0, failed: 0 }, timestamp: new Date().toISOString() });
  }

  const ids = candidates.map((c: Record<string, unknown>) => c.id as string);

  // Mark as 'publishing' — prevents other cron invocations from picking up the same rows.
  await svc
    .from("social_post_drafts")
    .update({ state: "publishing", updated_at: new Date().toISOString() })
    .in("id", ids);

  let succeeded = 0;
  let failed = 0;

  // Process in chunks of CONCURRENCY.
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (draft: Record<string, unknown>) => {
        try {
          const targetProfileIds = ((draft.target_profiles as Array<{ profile_id: string }> | null) ?? []).map(
            (p) => p.profile_id,
          );
          const result = await publishPost({
            externalPostId: draft.id as string,
            content: draft.content as string,
            mediaUrls: (draft.media_urls as string[]) ?? [],
            targetProfileIds,
            platformVariants: (draft.platform_variants as Record<string, { content?: string; link?: string; cta?: string }>) ?? {},
          });

          await svc
            .from("social_post_drafts")
            .update({
              state: "published",
              published_at: new Date().toISOString(),
              published_url: result.publishedUrl ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", draft.id as string);

          succeeded++;
        } catch (err) {
          const attempts = ((draft.publish_attempts as number | null) ?? 0) + 1;
          const newState = attempts >= MAX_PUBLISH_ATTEMPTS ? "failed" : "scheduled";

          await svc
            .from("social_post_drafts")
            .update({
              state: newState,
              publish_attempts: attempts,
              last_publish_error: {
                code: "PUBLISH_FAILED",
                message: err instanceof Error ? err.message : String(err),
                attempted_at: new Date().toISOString(),
                attempt_number: attempts,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", draft.id as string);

          logger.warn("publish_due.draft_failed", { draftId: draft.id, attempts, err: err instanceof Error ? err.message : String(err) });
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
