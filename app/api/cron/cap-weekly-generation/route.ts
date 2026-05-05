import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { generateCAPPosts } from "@/lib/platform/social/cap";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// D4 — GET /api/cron/cap-weekly-generation
//
// Weekly Vercel cron (Mondays 06:00 UTC). Finds all companies where
// cap_weekly_enabled = true, generates 3 CAP draft posts each via
// the existing generateCAPPosts lib, and returns a summary.
//
// Each company is processed independently — a failure on one company
// does NOT stop the rest. All posts land in state='draft' and flow
// through the normal approval pipeline.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const svc = getServiceRoleClient();

  const { data: companies, error } = await svc
    .from("platform_companies")
    .select("id")
    .eq("cap_weekly_enabled", true);

  if (error) {
    logger.error("cap.weekly.query_failed", { err: error.message });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: error.message, retryable: true },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  const examined = companies?.length ?? 0;
  let succeeded = 0;
  let failed = 0;

  logger.info("cap.weekly.start", { examined });

  for (const company of companies ?? []) {
    const result = await generateCAPPosts({
      companyId: company.id as string,
      count: 3,
      triggeredBy: null,
    });

    if (result.ok) {
      succeeded++;
      logger.info("cap.weekly.company_done", {
        companyId: company.id,
        posts: result.posts.length,
      });
    } else {
      failed++;
      logger.error("cap.weekly.company_failed", {
        companyId: company.id,
        code: result.error.code,
        message: result.error.message,
      });
    }
  }

  logger.info("cap.weekly.done", { examined, succeeded, failed });

  return NextResponse.json(
    {
      ok: true,
      data: { examined, succeeded, failed },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
