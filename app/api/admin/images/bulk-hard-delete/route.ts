import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody } from "@/lib/http";
import { bulkHardDeleteImages } from "@/lib/image-library";
import { logger } from "@/lib/logger";

// POST /api/admin/images/bulk-hard-delete
//
// Permanently removes multiple images (Cloudflare + Supabase).
// Body: { ids: string[] }
// Returns per-id success/error breakdown.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  ids: z
    .array(z.string().regex(UUID_RE, "Each id must be a UUID"))
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  const body = await readJsonBody(req);
  if (body === undefined) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Request body must be valid JSON.", retryable: false }, timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Body failed validation.", details: { issues: parsed.error.issues }, retryable: false },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await bulkHardDeleteImages(parsed.data.ids, { deletedBy: gate.user?.id ?? null });

  logger.info("images.bulk_hard_deleted", {
    deleted_count: result.ok ? result.data.deleted.length : 0,
    error_count: result.ok ? result.data.errors.length : 0,
    by: gate.user?.id ?? null,
  });

  revalidatePath("/admin/images");

  return NextResponse.json(result, { status: 200 });
}
