import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/cron/check-webhook-health
//
// Daily cron (recommended: 09:00 UTC, after social-connections-health at
// 03:00). Checks whether every active bundle.social team has delivered at
// least one webhook in the past 24 hours.
//
// Silence usually means bundle.social auto-disabled our webhook endpoint
// after 50 consecutive delivery failures (their documented behaviour).
// The auto-disable window is typically 24h of no retries.
//
// When a team is silent: inserts a social_connection_alerts row with
// severity='warning' and message='No webhooks received in 24h — webhook
// endpoint may be disabled at bundle.social' for each of that team's
// active connections. This surfaces as a banner in the admin UI.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SILENCE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const svc = getServiceRoleClient();
  const now = Date.now();
  const silenceSince = new Date(now - SILENCE_THRESHOLD_MS).toISOString();

  // Find all teams that have at least one active connection.
  const { data: profiles, error: profilesErr } = await svc
    .from("platform_social_profiles")
    .select("id, company_id, bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);

  if (profilesErr) {
    logger.error("social.webhook_health.profiles_read_failed", {
      err: profilesErr.message,
    });
    return NextResponse.json(
      { ok: false, error: { message: profilesErr.message }, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }

  if (!profiles || profiles.length === 0) {
    return NextResponse.json(
      { ok: true, data: { checked: 0, silent: 0 }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  let checked = 0;
  let silent = 0;

  for (const profile of profiles) {
    const teamId = profile.bundle_social_team_id as string;

    // Has this team delivered a webhook in the past 24h?
    const { data: recent, error: recentErr } = await svc
      .from("social_webhook_events")
      .select("id")
      .eq("team_id", teamId)
      .gte("received_at", silenceSince)
      .limit(1)
      .maybeSingle();

    if (recentErr) {
      logger.warn("social.webhook_health.query_failed", {
        team_id: teamId,
        err: recentErr.message,
      });
      continue;
    }

    checked++;

    if (recent) continue; // At least one event in the window — healthy.

    // Check if this team has any active connections worth alerting on.
    const { data: activeConns } = await svc
      .from("social_connections")
      .select("id, company_id")
      .eq("company_id", profile.company_id as string)
      .in("status", ["healthy", "pending_identity"])
      .limit(10);

    if (!activeConns || activeConns.length === 0) continue;

    silent++;
    logger.warn("social.webhook_health.team_silent", {
      team_id: teamId,
      company_id: profile.company_id,
      active_connections: activeConns.length,
    });

    // Insert one alert per company (not per connection — one is enough to surface the issue).
    const firstConn = activeConns[0];
    if (firstConn) {
      const { error: alertErr } = await svc
        .from("social_connection_alerts")
        .insert({
          connection_id: firstConn.id as string,
          company_id: firstConn.company_id as string,
          severity: "warning",
          message:
            "No webhooks received from bundle.social in 24h — " +
            "the webhook endpoint may have been auto-disabled. " +
            "Check /api/webhooks/bundlesocial delivery logs at bundle.social.",
        });
      if (alertErr) {
        logger.warn("social.webhook_health.alert_insert_failed", {
          err: alertErr.message,
          connection_id: firstConn.id,
        });
      }
    }
  }

  logger.info("social.webhook_health.complete", { checked, silent });

  return NextResponse.json(
    {
      ok: true,
      data: { checked, silent },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
