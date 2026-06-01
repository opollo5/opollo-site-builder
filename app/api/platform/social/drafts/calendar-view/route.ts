import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
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
    .select("id, state, scheduled_at, published_at, content, media_urls, media_asset_ids, target_profiles, parent_draft_id, link_url")
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

  // Resolve media_asset_ids → signed URLs for thumbnail display.
  // Same pattern as getDraft() (PR #1223) but batched for efficiency:
  // one social_media_assets SELECT + one createSignedUrls call covers
  // all posts in the calendar range.
  //
  // We only need the FIRST asset per post (primary_media_url), so we
  // collect only the first asset ID from each row that has media_asset_ids
  // but empty/missing media_urls.
  const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
  const SIGNED_URL_TTL = 3600;

  // Build a map: assetId → signedUrl for all first-asset IDs in this batch.
  const assetIdToSignedUrl = new Map<string, string>();

  const firstAssetIds = (data ?? [])
    .map((row) => {
      const hasLegacy = ((row.media_urls as string[] | null) ?? []).length > 0;
      if (hasLegacy) return null; // legacy media_urls take precedence — no resolution needed
      const ids = (row.media_asset_ids as string[] | null) ?? [];
      return ids[0] ?? null; // only the first asset (for primary_media_url)
    })
    .filter((id): id is string => id !== null);

  const uniqueFirstIds = [...new Set(firstAssetIds)];

  if (uniqueFirstIds.length > 0) {
    try {
      // Fetch storage paths in one query.
      const { data: assetRows, error: assetErr } = await svc
        .from("social_media_assets")
        .select("id, storage_path")
        .in("id", uniqueFirstIds);

      if (assetErr) {
        logger.warn("calendar_view.asset_lookup_failed", { err: assetErr.message });
      } else if (assetRows && assetRows.length > 0) {
        // Batch-sign all storage paths in one call.
        const paths = (assetRows as Array<{ id: string; storage_path: string }>)
          .map((r) => r.storage_path);
        const { data: signed, error: signErr } = await svc.storage
          .from(IMAGE_GEN_BUCKET)
          .createSignedUrls(paths, SIGNED_URL_TTL);

        if (signErr) {
          logger.warn("calendar_view.asset_sign_failed", { err: signErr.message });
        } else {
          // Build assetId → signedUrl map using the signed results (same order as paths).
          const pathToSigned = new Map<string, string>();
          for (const s of signed ?? []) {
            if (s.signedUrl && s.path) pathToSigned.set(s.path, s.signedUrl);
          }
          for (const row of assetRows as Array<{ id: string; storage_path: string }>) {
            const url = pathToSigned.get(row.storage_path);
            if (url) assetIdToSignedUrl.set(row.id, url);
          }
        }
      }
    } catch (err) {
      // Fail-soft: thumbnails will be missing but calendar still loads.
      logger.warn("calendar_view.asset_resolve_threw", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const posts = (data ?? [])
    .filter((row) => {
      if (profileIds.length === 0) return true;
      const profiles = (row.target_profiles as Array<{ profile_id: string }> | null) ?? [];
      return profiles.some((p) => profileIds.includes(p.profile_id));
    })
    .map((row) => {
      // primary_media_url: legacy media_urls first, then first resolved asset ID.
      const legacyUrls = (row.media_urls as string[] | null) ?? [];
      const assetIds = (row.media_asset_ids as string[] | null) ?? [];
      const primaryMediaUrl =
        legacyUrls[0] ??
        (assetIds[0] ? (assetIdToSignedUrl.get(assetIds[0]) ?? null) : null);

      return {
        id: row.id as string,
        state: row.state as string,
        scheduled_at: row.scheduled_at as string | null,
        published_at: row.published_at as string | null,
        content_excerpt: ((row.content as string | null) ?? "").slice(0, 100),
        primary_media_url: primaryMediaUrl,
        link_url: (row.link_url as string | null) ?? null,
        target_profiles: ((row.target_profiles as Array<{ profile_id: string }> | null) ?? []).map(
          (p) => ({ platform: null, account_avatar_url: null, profile_id: p.profile_id }),
        ),
        is_recurring_child: row.parent_draft_id !== null,
      };
    });

  const responseData = { posts, range: { from, to } };

  return NextResponse.json({ ok: true, data: responseData, timestamp: new Date().toISOString() });
}
