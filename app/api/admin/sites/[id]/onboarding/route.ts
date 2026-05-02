import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/sites/[id]/onboarding
//
// Persists the operator's mode choice from /admin/sites/[id]/onboarding
// and returns the URL to redirect to next. Re-onboarding (mode change)
// is allowed — the wizard / extraction surfaces are forward-only with
// their own state machines, but the operator can flip the mode if they
// realise mid-stream that the wrong path was taken.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  site_mode: z.enum(["copy_existing", "new_design"]),
});

function nextRedirect(siteId: string, mode: "copy_existing" | "new_design"): string {
  if (mode === "copy_existing") return `/admin/sites/${siteId}/setup/extract`;
  return `/admin/sites/${siteId}/setup?step=1`;
}

export async function POST(
  req: NextRequest,
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { site_mode: 'copy_existing' | 'new_design' }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  // audit columns not yet on sites — DATA_CONVENTIONS rollout pending
  const upd = await supabase
    .from("sites")
    .update({
      site_mode: parsed.data.site_mode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("id, site_mode")
    .maybeSingle();

  if (upd.error) {
    logger.error("site.onboarding.update_failed", {
      site_id: params.id,
      error: upd.error.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to save site mode.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
  if (!upd.data) {
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

  revalidatePath(`/admin/sites/${params.id}`);
  revalidatePath(`/admin/sites/${params.id}/onboarding`);

  return NextResponse.json(
    {
      ok: true,
      data: {
        site_mode: parsed.data.site_mode,
        redirect_to: nextRedirect(params.id, parsed.data.site_mode),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
