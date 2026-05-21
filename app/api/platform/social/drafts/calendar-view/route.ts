import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { validationError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/platform/social/drafts/calendar-view?company_id=&from=&to=&profile_ids=
//
// Returns posts in a date range for the dashboard calendar grid.
// No server-side cache: this endpoint is force-dynamic; SWR deduplication
// (dedupingInterval:30s) on the client provides sufficient coalescing.
// Redis caching was removed because it served stale data after swrMutate
// invalidation, permanently hiding newly-scheduled posts (P0 bug).
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const profileIdsParam = url.searchParams.get("profile_ids");

  if (!companyId) return validationError("company_id is required.");
  if (!from || !to) return validationError("from and to are required.");

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const profileIds = profileIdsParam ? profileIdsParam.split(",").filter(Boolean) : [];

  const svc = getServiceRoleClient();
  let query = svc
    .from("social_post_drafts")
    .select("id, state, scheduled_at, published_at, content, media_urls, link_url, target_profiles, parent_draft_id")
    .eq("company_id", companyId)
    .is("archived_at", null)
    .or(`scheduled_at.gte.${from},published_at.gte.${from}`)
    .or(`scheduled_at.lte.${to}T23:59:59Z,published_at.lte.${to}T23:59:59Z`)
    .order("scheduled_at", { ascending: true })
    .limit(200);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: error.message }, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }

  const posts = (data ?? [])
    .filter((row) => {
      if (profileIds.length === 0) return true;
      const profiles = (row.target_profiles as Array<{ profile_id: string }> | null) ?? [];
      return profiles.some((p) => profileIds.includes(p.profile_id));
    })
    .map((row) => ({
      id: row.id as string,
      state: row.state as string,
      scheduled_at: row.scheduled_at as string | null,
      published_at: row.published_at as string | null,
      content_excerpt: ((row.content as string | null) ?? "").slice(0, 100),
      primary_media_url: ((row.media_urls as string[] | null) ?? [])[0] ?? null,
      link_url: (row.link_url as string | null) ?? null,
      target_profiles: ((row.target_profiles as Array<{ profile_id: string }> | null) ?? []).map(
        (p) => ({ platform: null, account_avatar_url: null, profile_id: p.profile_id }),
      ),
      is_recurring_child: row.parent_draft_id !== null,
    }));

  const responseData = { posts, range: { from, to } };

  return NextResponse.json({ ok: true, data: responseData, timestamp: new Date().toISOString() });
}
