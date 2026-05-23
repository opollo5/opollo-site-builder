import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/platform/social/media/image-library?company_id=<uuid>[&before=<iso>]
//
// Returns a cursor-paginated page of image_library rows formatted as
// MediaAsset for MediaPickerModal. Replaces the social_media_assets-backed
// GET /api/platform/social/media endpoint for the Library tab.
//
// Auth: view_calendar (viewer+) on the company.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PAGE_SIZE = 50;

type MediaAsset = {
  id: string;
  source_url: string | null;
  mime_type: string;
  bytes: number;
  scope: "global";
  created_at: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id required.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const before = url.searchParams.get("before") ?? undefined;
  const deliveryHash = process.env.CLOUDFLARE_IMAGES_HASH ?? "";

  const svc = getServiceRoleClient();
  let query = svc
    .from("image_library")
    .select("id, cloudflare_id, bytes, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query;
  if (error) {
    return internalError(`Failed to load image library: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    cloudflare_id: string | null;
    bytes: number | null;
    created_at: string;
  }>;
  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const assets: MediaAsset[] = page.map((r) => ({
    id: r.id,
    source_url: r.cloudflare_id
      ? `https://imagedelivery.net/${deliveryHash}/${r.cloudflare_id}/public`
      : null,
    mime_type: "image/jpeg",
    bytes: Number(r.bytes ?? 0),
    scope: "global",
    created_at: r.created_at,
  }));

  const nextCursor = hasMore ? page[page.length - 1].created_at : null;

  return NextResponse.json({
    ok: true,
    data: { assets, next_cursor: nextCursor },
    timestamp: new Date().toISOString(),
  });
}
