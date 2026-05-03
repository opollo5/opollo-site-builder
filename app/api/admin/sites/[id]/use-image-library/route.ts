import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, validationError } from "@/lib/http";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/sites/[id]/use-image-library
// Body: { enabled: boolean }
// Toggles sites.use_image_library. Admin-gated; per-site, no
// version_lock (single boolean, idempotent re-write).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({ enabled: z.boolean() });

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

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { enabled: boolean }.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const upd = await supabase
    .from("sites")
    .update({
      use_image_library: parsed.data.enabled,
      updated_at: new Date().toISOString(),
      updated_by: gate.user?.id ?? null,
    })
    .eq("id", params.id)
    .select("id, use_image_library")
    .maybeSingle();

  if (upd.error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to update toggle.",
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

  revalidatePath(`/admin/sites/${params.id}/settings`);

  return NextResponse.json(
    {
      ok: true,
      data: { use_image_library: upd.data.use_image_library },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
