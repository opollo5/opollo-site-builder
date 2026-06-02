import { NextResponse, type NextRequest } from "next/server";

import { internalError, notFound, validateUuidParam } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { resetApprovalToFresh } from "@/lib/image/batch-ops";

// ---------------------------------------------------------------------------
// POST /api/platform/image/batch/[id]/reset
//
// Revokes all open approval requests and clears image selections so the batch
// can re-enter the approval cycle. Does NOT delete jobs or the batch.
//
// Auth: canDo("manage_users") — admin only.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();

  // Fetch batch to get company_id for auth gate and tenant scoping.
  const { data: batch, error: batchErr } = await svc
    .from("image_generation_batches")
    .select("id, company_id")
    .eq("id", idCheck.value)
    .single();

  if (batchErr || !batch) {
    if (batchErr?.code === "PGRST116") return notFound(`Batch ${id} not found.`);
    logger.error("image.batch.reset.fetch_failed", { batchId: id, error: batchErr?.message });
    return internalError("Failed to fetch batch.");
  }

  const gate = await requireCanDoForApi(batch.company_id as string, "manage_users");
  if (gate.kind === "deny") return gate.response;

  await resetApprovalToFresh(idCheck.value, batch.company_id as string, gate.userId);

  return NextResponse.json({
    ok: true,
    data: { reset: true, batchId: id },
    timestamp: new Date().toISOString(),
  });
}
