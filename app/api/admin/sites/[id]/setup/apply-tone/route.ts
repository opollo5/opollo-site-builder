import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { applyToneToHomepage } from "@/lib/design-discovery/apply-tone";

// POST /api/admin/sites/[id]/setup/apply-tone
//
// Fired by the client immediately after tone approval. Reads the
// approved homepage + tone JSONB from the site row; rewrites only
// the hero / CTA / first service card text via Claude; persists to
// sites.tone_applied_homepage_html. Failure is silent — the route
// returns ok=false but the caller falls back to the original
// approved homepage per the spec.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const result = await applyToneToHomepage(params.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: result.error.code, message: result.error.message, retryable: false },
        timestamp: new Date().toISOString(),
      },
      // 200 even on failure so the client treats it as a soft skip
      // — the spec says "If API call fails: silently skip, show
      // original approved concept, do not block flow or show error."
      { status: 200 },
    );
  }

  revalidatePath(`/admin/sites/${params.id}/setup`);
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
