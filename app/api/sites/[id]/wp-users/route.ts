import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getSite } from "@/lib/sites";
import { wpListUsers, type WpConfig } from "@/lib/wordpress";

// GET /api/sites/[id]/wp-users
//
// Fetches WordPress users for the site. Used by BlogPostComposer
// author picker. Requires list_users capability on the WP app password;
// gracefully returns 403 if the credential lacks that permission.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
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

  const result = await wpListUsers(cfg);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.code, message: result.message } },
      { status: result.code === "AUTH_FAILED" ? 403 : 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: { items: result.items } },
    { headers: { "cache-control": "no-store" } },
  );
}
