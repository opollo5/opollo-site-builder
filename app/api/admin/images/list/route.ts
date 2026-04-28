import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
import {
  LIST_IMAGES_DEFAULT_LIMIT,
  LIST_IMAGES_MAX_LIMIT,
  listImages,
  type ImageListItem,
} from "@/lib/image-library";

// ---------------------------------------------------------------------------
// GET /api/admin/images/list — BP-4.
//
// Polled by the image picker modal. Wraps lib/image-library.listImages
// with FTS search + pagination. Caller pre-computes the Cloudflare
// delivery URL server-side because the client doesn't have access to
// CLOUDFLARE_IMAGES_HASH.
//
// Query params:
//   q      — free-text search (caption + alt + filename, FTS)
//   limit  — capped at LIST_IMAGES_MAX_LIMIT
//   offset — non-negative integer
//
// Auth: admin OR operator (matches the BP-3 entry-point's role policy).
// Soft-deleted images excluded by default.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ImagePickerEntry extends ImageListItem {
  delivery_url: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const url = new URL(req.url);
  const rawQ = url.searchParams.get("q");
  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");

  const q = rawQ && rawQ.trim().length > 0 ? rawQ.trim() : undefined;
  const limit = (() => {
    if (!rawLimit) return LIST_IMAGES_DEFAULT_LIMIT;
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) return LIST_IMAGES_DEFAULT_LIMIT;
    return Math.min(LIST_IMAGES_MAX_LIMIT, Math.floor(n));
  })();
  const offset = (() => {
    if (!rawOffset) return 0;
    const n = Number(rawOffset);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  })();

  const result = await listImages({ query: q, limit, offset, deleted: false });
  if (!result.ok) {
    return NextResponse.json(
      { ...result },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }

  const items: ImagePickerEntry[] = result.data.items.map((item) => ({
    ...item,
    delivery_url: item.cloudflare_id ? deliveryUrl(item.cloudflare_id) : null,
  }));

  return NextResponse.json(
    {
      ok: true,
      data: {
        items,
        total: result.data.total,
        limit: result.data.limit,
        offset: result.data.offset,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
