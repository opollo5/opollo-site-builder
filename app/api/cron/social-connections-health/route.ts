import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { getServiceRoleClient } from "@/lib/supabase";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections/sync";

// ---------------------------------------------------------------------------
// F1 — GET /api/cron/social-connections-health
//
// Daily Vercel cron (03:00 UTC). Iterates every platform_companies row
// that has a bundle_social_team_id, calls syncBundlesocialConnections
// in health-refresh mode (no attribution) for each — marks connections
// healthy/disconnected and updates last_health_check_at. This ensures
// stale connections surface in the UI before operators notice a failed
// publish.
//
// No-op when BUNDLE_SOCIAL_API is unset.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  if (!process.env.BUNDLE_SOCIAL_API) {
    logger.debug("social.connections.health.cron: bundle.social not configured, skipping");
    return NextResponse.json(
      { ok: true, data: { status: "skipped", reason: "BUNDLE_SOCIAL_API not configured" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  const svc = getServiceRoleClient();
  const { data: companies, error } = await svc
    .from("platform_companies")
    .select("id")
    .not("bundle_social_team_id", "is", null);

  if (error) {
    logger.error("social.connections.health.cron_companies_read_failed", { err: error.message });
    return NextResponse.json(
      { ok: false, error: { message: error.message }, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }

  const companyIds = (companies ?? []).map((c) => c.id as string);
  let companies_synced = 0;
  let companies_failed = 0;
  const totals = { inserted: 0, updated: 0, marked_disconnected: 0, unmapped_skipped: 0 };

  for (const companyId of companyIds) {
    const result = await syncBundlesocialConnections({ companyId });
    if (!result.ok) {
      logger.error("social.connections.health.cron_company_failed", {
        company_id: companyId,
        err: result.error.message,
      });
      companies_failed += 1;
      continue;
    }
    companies_synced += 1;
    totals.inserted += result.data.inserted;
    totals.updated += result.data.updated;
    totals.marked_disconnected += result.data.marked_disconnected;
    totals.unmapped_skipped += result.data.unmapped_skipped;
  }

  const data = { companies_synced, companies_failed, ...totals };
  logger.info("social.connections.health.cron_ok", data);

  return NextResponse.json(
    { ok: true, data, timestamp: new Date().toISOString() },
    { status: companies_failed > 0 ? 207 : 200 },
  );
}

export const GET = handle;
export const POST = handle;