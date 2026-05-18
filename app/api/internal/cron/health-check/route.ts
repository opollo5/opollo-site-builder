import { NextResponse, type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { notifyHealthAlert } from "@/lib/platform/service-health/notify";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/internal/cron/health-check
// Schedule: */5 * * * *
//
// Finds unresolved critical service_health_events with
// notified_at IS NULL OR notified_at < NOW() - 30min.
// Fires notifications for each qualifying event.
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
  const cooldownCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: events, error } = await svc
    .from("service_health_events")
    .select("*")
    .eq("severity", "critical")
    .is("resolved_at", null)
    .or(`notified_at.is.null,notified_at.lt.${cooldownCutoff}`)
    .order("first_seen_at", { ascending: true })
    .limit(20);

  if (error) {
    logger.error("health_check.query_failed", { err: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let notified = 0;

  for (const event of events ?? []) {
    try {
      await notifyHealthAlert(event as Parameters<typeof notifyHealthAlert>[0]);
      await svc
        .from("service_health_events")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", event.id as string);
      notified++;
    } catch (err) {
      logger.warn("health_check.notify_failed", { eventId: event.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  await updateHeartbeat("health-check", "ok");

  return NextResponse.json({
    ok: true,
    data: { checked: (events ?? []).length, notified },
    timestamp: new Date().toISOString(),
  });
}
