import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { reextractImageMetadata } from "@/lib/image-reextract";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// POST /api/admin/images/[id]/reextract
//
// Re-derives width / height / iStock id from the stored Cloudflare bytes
// + filename. Idempotent. Returns the extraction summary so the UI can
// show a meaningful toast.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
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
          message: "Image id must be a UUID.",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await reextractImageMetadata(params.id, {
    updatedBy: gate.user?.id ?? null,
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(result, { status });
  }

  revalidatePath(`/admin/images/${params.id}`);
  revalidatePath("/admin/images");

  return NextResponse.json(result, { status: 200 });
}
