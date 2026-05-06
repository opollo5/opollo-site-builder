import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { hardDeleteImage } from "@/lib/image-library";
import { logger } from "@/lib/logger";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// DELETE /api/admin/images/[id]/hard-delete
//
// Permanently removes the image from Cloudflare Images and from
// Supabase (image_usage rows deleted first; image_metadata cascades).
// This cannot be undone. Admin-only gate (not operator).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
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
        error: { code: "VALIDATION_FAILED", message: "Image id must be a UUID.", retryable: false },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await hardDeleteImage(params.id, { deletedBy: gate.user?.id ?? null });

  if (!result.ok) {
    logger.error("hardDeleteImage failed", { code: result.error.code, id: params.id });
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(result, { status });
  }

  logger.info("image.hard_deleted", { image_id: params.id, by: gate.user?.id ?? null });

  revalidatePath("/admin/images");

  return NextResponse.json(result, { status: 200 });
}
