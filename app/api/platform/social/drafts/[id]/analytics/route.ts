import { NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getAnalytics, setAnalytics, getAnalyticsStale } from "@/lib/platform/cache";
import { fetchAnalytics } from "@/lib/social/publishing/bundle-social-client";
import { internalError, notFound, validateUuidParam } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/platform/social/drafts/[id]/analytics
//
// Two-layer cache: Redis (60s TTL) → Postgres → bundle.social origin.
// On Redis error: falls through to Postgres cold cache.
// On bundle.social error: returns last known stale values with is_stale=true.
// ---------------------------------------------------------------------------

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("company_id, state")
    .eq("id", idCheck.value)
    .maybeSingle();

  if (!draft) return notFound(`Draft ${id} not found.`);

  const gate = await requireCanDoForApi(draft.company_id as string, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("chat", `user:${gate.userId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // 1. Try hot+cold cache.
  const cached = await getAnalytics(idCheck.value, 60);
  if (cached) {
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    return NextResponse.json({
      ok: true,
      data: { ...cached, is_stale: cached.fetched_at < staleCutoff },
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Cache miss — try bundle.social origin.
  try {
    const fresh = await fetchAnalytics(idCheck.value);
    void setAnalytics(idCheck.value, fresh);
    return NextResponse.json({
      ok: true,
      data: { ...fresh, is_stale: false },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn("analytics.origin_failed", { draftId: id, err: err instanceof Error ? err.message : String(err) });
    // 3. Stale fallback.
    const stale = await getAnalyticsStale(idCheck.value);
    if (stale) {
      return NextResponse.json({
        ok: true,
        data: { ...stale, is_stale: true },
        timestamp: new Date().toISOString(),
      });
    }
    // 4. No data at all.
    return NextResponse.json({
      ok: true,
      data: {
        impressions: null,
        engagement_rate: null,
        reactions: null,
        shares: null,
        comments: null,
        clicks: null,
        platform_specific: {},
        fetched_at: new Date().toISOString(),
        is_stale: true,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
