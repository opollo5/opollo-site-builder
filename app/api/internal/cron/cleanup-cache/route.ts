import { NextResponse, type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;

// ---------------------------------------------------------------------------
// POST /api/internal/cron/cleanup-cache
// Schedule: 0 3 * * * (daily at 3am UTC)
//
// Deletes social_post_analytics_cache rows older than 90 days.
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
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await svc
    .from("social_post_analytics_cache")
    .delete({ count: "exact" })
    .lt("fetched_at", cutoff);

  if (error) {
    logger.error("cleanup_cache.delete_failed", { err: error.message });
    await updateHeartbeat("cleanup-cache", "error", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  await updateHeartbeat("cleanup-cache", "ok");
  logger.info("cleanup_cache.done", { deleted: count ?? 0 });

  return NextResponse.json({
    ok: true,
    data: { deleted: count ?? 0 },
    timestamp: new Date().toISOString(),
  });
}
