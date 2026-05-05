import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { syncBundlesocialConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-16 — POST /api/platform/social/connections/sync
//
// Manual admin trigger to refresh status / display_name / avatar from
// bundle.social. Useful when:
//   - A reviewer reports the calendar is stale.
//   - A connection was reconnected externally and we want to clear
//     a stuck "auth_required" status.
//   - We want a fresh last_health_check_at without waiting for the
//     periodic cron (when that lands).
//
// Body: { company_id } (required for the canDo gate; the underlying
// lib touches every row, but we still scope the auth to the company
// the admin is currently in).
//
// No new-account attribution on this path — that's only for the
// callback route after a connect flow completes.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
});

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid }.",
      400,
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_connections",
  );
  if (gate.kind === "deny") return gate.response;

  const result = await syncBundlesocialConnections({});
  if (!result.ok) {
    return errorJson(result.error.code, result.error.message, 500);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
