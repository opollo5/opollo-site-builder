import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getSite } from "@/lib/sites";
import { wpListPages, type WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// GET /api/sites/[id]/wp-pages — BP-8.
//
// Per-site proxy of WP /wp/v2/pages. Used by the BlogPostComposer's
// parent-page combobox so the operator picks from the site's actual
// WP page tree instead of typing a slug.
//
// Query params:
//   q   — optional search string (forwarded to WP `search`)
//
// Auth: admin OR operator. Site WP credentials read via
// getSite({ includeCredentials: true }), same pattern as the publish
// route.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();

  const siteRes = await getSite(params.id, { includeCredentials: true });
  if (!siteRes.ok) {
    return errorJson(
      siteRes.error.code,
      siteRes.error.message,
      siteRes.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }
  const creds = siteRes.data.credentials;
  if (!creds) {
    return errorJson(
      "INTERNAL_ERROR",
      "Site has no WP credentials.",
      500,
    );
  }
  const cfg: WpConfig = {
    baseUrl: siteRes.data.site.wp_url,
    user: creds.wp_user,
    appPassword: creds.wp_app_password,
  };

  const wp = await wpListPages(cfg, {
    status: "publish",
    ...(q ? { search: q } : {}),
  });
  if (!wp.ok) {
    return errorJson(wp.code, wp.message, 502);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { pages: wp.pages },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
