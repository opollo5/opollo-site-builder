import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { runDriftDetector } from "@/lib/drift-detector";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/drift-detect — M16-8.
//
// Hourly cron that checks whether WordPress page content has drifted from
// what Opollo last published.  For each site with at least one published M16
// page, fetches WP raw content, hashes it, and compares against
// route_registry.wp_content_hash.  On mismatch sets pages.wp_status =
// 'drift_detected'.
//
// WP credentials are loaded per-site via getSite({ includeCredentials: true }).
// Sites without WP credentials skip silently.
//
// Schedule: hourly (0 * * * *), see vercel.json.
// Authentication: Bearer CRON_SECRET.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const filler = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, filler);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Invalid cron secret.", retryable: false },
        timestamp: new Date().toISOString(),
      },
      { status: 401 },
    );
  }

  try {
    const svc = getServiceRoleClient();

    // Find distinct site_ids that have at least one M16-published page
    // (wp_status in 'published' or 'drift_detected') with a wp_page_id.
    const { data: publishedRows, error } = await svc
      .from("pages")
      .select("site_id")
      .in("wp_status", ["published", "drift_detected"])
      .not("wp_page_id", "is", null);

    if (error) {
      logger.error("cron.drift_detect.lookup_failed", { error: error.message });
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "Published-pages lookup failed.", retryable: true },
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }

    const siteIds = [...new Set((publishedRows ?? []).map(r => r.site_id as string))];

    if (siteIds.length === 0) {
      return NextResponse.json(
        { ok: true, data: { sites: [] }, timestamp: new Date().toISOString() },
        { status: 200 },
      );
    }

    const results: { siteId: string; checked: number; drifted: number; errors: number }[] = [];

    for (const siteId of siteIds) {
      const siteResult = await getSite(siteId, { includeCredentials: true });
      if (!siteResult.ok || !siteResult.data.credentials) {
        // No credentials — skip this site silently
        continue;
      }
      const { site, credentials } = siteResult.data;
      if (!site.wp_url) continue;

      const cfg = {
        baseUrl: site.wp_url as string,
        user: credentials.wp_user,
        appPassword: credentials.wp_app_password,
      };

      const res = await runDriftDetector(siteId, cfg);
      results.push({
        siteId,
        checked: res.ok ? res.checked : 0,
        drifted: res.ok ? res.drifted : 0,
        errors:  res.ok ? res.errors  : 1,
      });
    }

    logger.info("cron.drift_detect.done", {
      sites:        siteIds.length,
      totalChecked: results.reduce((s, r) => s + r.checked, 0),
      totalDrifted: results.reduce((s, r) => s + r.drifted, 0),
      totalErrors:  results.reduce((s, r) => s + r.errors,  0),
    });

    return NextResponse.json(
      { ok: true, data: { sites: results }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cron.drift_detect.tick_failed", { error: message });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message, retryable: true },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
