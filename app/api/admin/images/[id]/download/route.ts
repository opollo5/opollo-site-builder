import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
import { getServiceRoleClient } from "@/lib/supabase";

// GET /api/admin/images/[id]/download
//
// Streams the full-resolution Cloudflare delivery bytes back to the
// browser with `Content-Disposition: attachment` so the operator gets
// a real download instead of a tab open. Proxies via the server because
// the cross-origin `download` attribute on a plain <a> tag is ignored
// without a same-origin response.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function quoteFilename(name: string): string {
  return name.replace(/"/g, "").replace(/[\r\n]/g, "");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Image id must be a UUID.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const row = await supabase
    .from("image_library")
    .select("id, cloudflare_id, filename")
    .eq("id", params.id)
    .maybeSingle();

  if (row.error || !row.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Image not found.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    );
  }

  const cloudflareId = row.data.cloudflare_id as string | null;
  if (!cloudflareId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "PRECONDITION_FAILED",
          message: "Image has no Cloudflare id; nothing to download.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 412 },
    );
  }

  const url = deliveryUrl(cloudflareId, "public");
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "CLOUDFLARE_CONFIG_MISSING",
          message: "CLOUDFLARE_IMAGES_HASH is not configured on the server.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "CLOUDFLARE_FETCH_FAILED",
          message: `Cloudflare returned HTTP ${upstream.status}.`,
          retryable: upstream.status >= 500,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  const filename = quoteFilename(
    (row.data.filename as string | null) ?? `${cloudflareId}.bin`,
  );
  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
