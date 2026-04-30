import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { enqueueRegenJob } from "@/lib/regeneration-publisher";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/pages/[pageId]/regenerate — M7-4.
//
// Enqueues a single-page regeneration. Admin + operator gated.
// Snapshot of pages.version_lock captured at insert time so the
// worker's final commit can detect concurrent M6-3 edits.
//
// Failure shapes worth knowing:
//   - 400 VALIDATION_FAILED: non-UUID path params.
//   - 404 NOT_FOUND: page doesn't belong to this site (cross-site URL
//     manipulation guard).
//   - 409 REGEN_ALREADY_IN_FLIGHT: an earlier regen is still pending
//     or running for this page. The partial UNIQUE on
//     regeneration_jobs(page_id) WHERE status IN ('pending','running')
//     enforces this; the caller should wait for that job to finish.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(details ? { details } : {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; pageId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["super_admin", "admin"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("regen", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.pageId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "Site id and page id must be UUIDs.",
      400,
    );
  }

  const result = await enqueueRegenJob({
    site_id: params.id,
    page_id: params.pageId,
    created_by: gate.user?.id ?? null,
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.code);
    return errorJson(result.code, result.message, status, result.details);
  }

  revalidatePath(`/admin/sites/${params.id}/pages/${params.pageId}`);

  return NextResponse.json(
    {
      ok: true,
      data: { job_id: result.job_id },
      timestamp: new Date().toISOString(),
    },
    { status: 202 },
  );
}
