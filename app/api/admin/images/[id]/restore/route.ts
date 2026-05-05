import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { restoreImage } from "@/lib/image-library";
import { logger } from "@/lib/logger";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// POST /api/admin/images/[id]/restore — M5-4.
//
// Un-archives a soft-deleted image by clearing deleted_at + deleted_by.
// Idempotent on already-active rows (no-op UPDATE returns the row).
// Admin + operator gated. Separate POST route rather than a PATCH
// variant because the operation is a distinct action in the UI
// (different button, different confirm dialog copy).
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
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Image id must be a UUID.", 400);
  }

  const result = await restoreImage(params.id, {
    restored_by: gate.user?.id ?? null,
  });

  if (!result.ok) {
    logger.error("restoreImage failed", { code: result.error.code });
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(
      { ...result, timestamp: result.timestamp },
      { status },
    );
  }

  revalidatePath("/admin/images");
  revalidatePath(`/admin/images/${params.id}`);

  return NextResponse.json(
    { ...result, timestamp: result.timestamp },
    { status: 200 },
  );
}
