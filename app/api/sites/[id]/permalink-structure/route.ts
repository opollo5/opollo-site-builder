import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { getSite } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";
import { wpGetSettings, type WpConfig } from "@/lib/wordpress";

// GET /api/sites/[id]/permalink-structure
//
// Returns the WordPress permalink_structure for the site. Used by
// BlogPostComposer to render a URL preview below the slug field.
//
// Strategy:
//   1. Read sites.wp_permalink_structure from DB (cached from previous call).
//   2. If null, fetch from WP settings API and write back to cache.
//   3. On any WP failure, return null (empty string fallback) without
//      blocking the composer.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Site id must be a UUID." } },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();

  // Fast-path: return the cached value.
  const { data: row } = await supabase
    .from("sites")
    .select("id, wp_url, wp_permalink_structure")
    .eq("id", params.id)
    .neq("status", "removed")
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Site not found." } },
      { status: 404 },
    );
  }

  if (row.wp_permalink_structure !== null && row.wp_permalink_structure !== undefined) {
    return NextResponse.json(
      { ok: true, data: { permalink_structure: row.wp_permalink_structure as string } },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Cache miss — fetch from WP. Requires credentials.
  const siteRes = await getSite(params.id, { includeCredentials: true });
  if (!siteRes.ok || !siteRes.data.credentials) {
    return NextResponse.json(
      { ok: true, data: { permalink_structure: null } },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const cred = siteRes.data.credentials;
  const cfg: WpConfig = {
    baseUrl: siteRes.data.site.wp_url,
    user: cred.wp_user,
    appPassword: cred.wp_app_password,
  };

  let permalink_structure: string | null = null;
  try {
    const settingsRes = await wpGetSettings(cfg);
    if (settingsRes.ok) {
      const raw = settingsRes.settings?.permalink_structure;
      if (typeof raw === "string") permalink_structure = raw;
    }
  } catch (err) {
    logger.warn("permalink_structure.fetch_failed", {
      site_id: params.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (permalink_structure !== null) {
    await supabase
      .from("sites")
      .update({ wp_permalink_structure: permalink_structure })
      .eq("id", params.id);
  }

  return NextResponse.json(
    { ok: true, data: { permalink_structure } },
    { headers: { "cache-control": "no-store" } },
  );
}
