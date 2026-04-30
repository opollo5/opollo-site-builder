import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  DesignBriefSchema,
  saveDesignBrief,
} from "@/lib/design-discovery/design-brief";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/save-brief
//
// Step-1 progress save. Persists the operator-built design brief to
// sites.design_brief and (when advance_status=true) flips
// design_direction_status to 'in_progress' so the wizard can resume
// here.
//
// Body: { brief: DesignBrief, advance_status?: boolean }
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
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const wrapper = body as { brief?: unknown; advance_status?: unknown };
  const parsed = DesignBriefSchema.safeParse(wrapper?.brief ?? null);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "brief failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await saveDesignBrief(params.id, parsed.data, {
    advanceStatus: wrapper.advance_status === true,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      result.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  revalidatePath(`/admin/sites/${params.id}/setup`);
  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
