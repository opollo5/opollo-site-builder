import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections/sync";

// ---------------------------------------------------------------------------
// F1 — GET /api/cron/social-connections-health
//
// Daily Vercel cron (03:00 UTC). Calls syncBundlesocialConnections in
// health-refresh mode (no attribution) — walks the entire bundle.social
// team, marks healthy/disconnected, updates last_health_check_at. This
// ensures stale connections surface in the UI before operators notice
// a failed publish.
//
// No-op when BUNDLE_SOCIAL_API or BUNDLE_SOCIAL_TEAMID is unset.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  if (!process.env.BUNDLE_SOCIAL_API || !process.env.BUNDLE_SOCIAL_TEAMID) {
    logger.debug("social.connections.health.cron: bundle.social not configured, skipping");
    return NextResponse.json(
      { ok: true, data: { status: "skipped", reason: "bundle.social not configured" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  const result = await syncBundlesocialConnections({});

  if (!result.ok) {
    logger.error("social.connections.health.cron_failed", {
      err: result.error.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  logger.info("social.connections.health.cron_ok", result.data);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
