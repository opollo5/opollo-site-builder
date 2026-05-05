import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getSite } from "@/lib/sites";
import {
  wpListCategories,
  wpListTags,
  type WpConfig,
} from "@/lib/wordpress";

// GET /api/sites/[id]/wp-taxonomies?type=categories|tags
//
// Fetches WordPress categories or tags for the site. Used by
// BlogPostComposer to populate the category/tag pickers.
//
// Results are not cached on the server (taxonomy lists change rarely
// and are small; the client can cache within a session).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Site id must be a UUID." },
      },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  if (type !== "categories" && type !== "tags") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Query param type must be 'categories' or 'tags'.",
        },
      },
      { status: 400 },
    );
  }

  const siteRes = await getSite(params.id, { includeCredentials: true });
  if (!siteRes.ok || !siteRes.data.credentials) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: "Site not found or missing credentials." },
      },
      { status: 404 },
    );
  }

  const cred = siteRes.data.credentials;
  const cfg: WpConfig = {
    baseUrl: siteRes.data.site.wp_url,
    user: cred.wp_user,
    appPassword: cred.wp_app_password,
  };

  const result =
    type === "categories"
      ? await wpListCategories(cfg)
      : await wpListTags(cfg);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.code, message: result.message } },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: { items: result.items } },
    { headers: { "cache-control": "no-store" } },
  );
}
