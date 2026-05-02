import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/admin/images/check-existing
//
// Pre-flight duplicate check for the bulk-upload UI. Accepts up to
// MAX_FILENAMES filenames in one request and returns the subset that
// already exist (active rows) on image_library, with their ids so the
// client can render a "replace this one" decision per file. Soft-deleted
// rows are intentionally excluded — restoring an archived image is a
// separate operator action.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILENAMES = 200;

const BodySchema = z.object({
  filenames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(MAX_FILENAMES),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

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
          message: "Body must be { filenames: string[] } with up to 200 entries.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const filenames = Array.from(new Set(parsed.data.filenames));
  const supabase = getServiceRoleClient();
  const res = await supabase
    .from("image_library")
    .select("id, filename")
    .in("filename", filenames)
    .is("deleted_at", null);

  if (res.error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to look up existing filenames.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  const existing = (res.data ?? []).map((row) => ({
    image_id: row.id as string,
    filename: row.filename as string,
  }));

  return NextResponse.json(
    {
      ok: true,
      data: { existing },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
