import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { runRenderWorker } from "@/lib/render-worker";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/render-pages — M16-7.
//
// Finds sites that have at least one page with html_is_stale=true and
// runs the render worker for each. Designed to run on a low-frequency
// schedule (e.g. every 5 minutes) to flush any stale pages that weren't
// rendered synchronously in the brief runner tick.
//
// Authentication: same Bearer CRON_SECRET pattern as other cron routes.
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

    // Find distinct site_ids with at least one stale page
    const { data: staleRows, error } = await svc
      .from("pages")
      .select("site_id")
      .eq("html_is_stale", true)
      .is("deleted_at", null);

    if (error) {
      logger.error("cron.render_pages.lookup_failed", { error });
      return NextResponse.json(
        {
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "Stale-page lookup failed.", retryable: true },
          timestamp: new Date().toISOString(),
        },
        { status: 500 },
      );
    }

    const siteIds = [...new Set((staleRows ?? []).map(r => r.site_id as string))];
    const results: { siteId: string; rendered: number; errors: number }[] = [];

    for (const siteId of siteIds) {
      const res = await runRenderWorker({ siteId });
      results.push({
        siteId,
        rendered: res.rendered,
        errors:   res.errors,
      });
    }

    logger.info("cron.render_pages.done", {
      sites:       siteIds.length,
      totalRender: results.reduce((s, r) => s + r.rendered, 0),
      totalErrors: results.reduce((s, r) => s + r.errors, 0),
    });

    return NextResponse.json(
      { ok: true, data: { sites: results }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("cron.render_pages.tick_failed", { error: message });
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
