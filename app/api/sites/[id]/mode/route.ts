import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// GET /api/sites/[id]/mode
//
// Lightweight read of site_mode + the columns the design-system
// summary card needs. Separate from /api/sites/[id] so the
// design-system page (a client component) doesn't have to pull the
// full SiteRecord on every render.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
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
          message: "Site id must be a UUID.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const res = await supabase
    .from("sites")
    .select("site_mode, extracted_design, design_tokens, design_direction_status")
    .eq("id", params.id)
    .maybeSingle();

  if (res.error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to load site mode.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
  if (!res.data) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Site not found.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: res.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
