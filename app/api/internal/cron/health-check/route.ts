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
// Finds unresolved critical service_health_events that need a notification.
// An event qualifies when:
//   (a) notified_at IS NULL — never notified, alert fires immediately; OR
//   (b) notified_at < NOW() - 4h   — re-notification cooldown has elapsed
//       AND last_seen_at > notified_at — new failures have occurred since
//       the last notification (prevents stale events from re-alerting forever).
//
// The last_seen_at > notified_at gate is the core correctness fix:
// without it a stale event re-notifies every 30 min indefinitely even
// when the underlying service recovered and no new failures occurred.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

// Re-notification cooldown: how long must pass before we re-alert on a
// persistent active failure. 4 h is intentionally longer than the old 30 min
// — once the on-call team is paged, hourly re-pages add no value until the
// issue is progressing again (which last_seen_at > notified_at detects).
const RENOTIFY_COOLDOWN_MS = 4 * 60 * 60 * 1000;

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const svc = getServiceRoleClient();
  // All events past the re-notification cooldown window (including never-notified).
  const cooldownCutoff = new Date(Date.now() - RENOTIFY_COOLDOWN_MS).toISOString();

  // Fetch candidates: never notified OR cooldown has elapsed.
  // We then filter in TypeScript on last_seen_at > notified_at to skip
  // stale events that haven't had new failures since the last notification.
  // PostgREST does not support column-to-column comparisons in filter syntax,
  // so the final gate lives here.
  const { data: candidates, error } = await svc
    .from("service_health_events")
    .select("*")
    .eq("severity", "critical")
    .is("resolved_at", null)
    .or(`notified_at.is.null,notified_at.lt.${cooldownCutoff}`)
    .order("first_seen_at", { ascending: true })
    .limit(20);

  // Fix 1 — stale suppression: only notify when there are new failures since
  // the last notification, or when the event has never been notified.
  // A stale event (last_seen_at ≤ notified_at) means no new occurrences were
  // recorded after we already alerted; re-alerting adds no signal.
  const events = (candidates ?? []).filter(
    (e) => e.notified_at === null || (e.last_seen_at as string) > (e.notified_at as string),
  );

  if (error) {
    logger.error("health_check.query_failed", { err: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let notified = 0;

  for (const event of events) {
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
    data: {
      candidates: (candidates ?? []).length,  // fetched by query
      stale_suppressed: (candidates ?? []).length - events.length,  // dropped by last_seen_at gate
      checked: events.length,   // passed the filter
      notified,
    },
    timestamp: new Date().toISOString(),
  });
}
