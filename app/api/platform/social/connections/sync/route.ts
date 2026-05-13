import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, internalError } from "@/lib/http";
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
// lib scopes the sync to this company's bundle.social team).
//
// No new-account attribution on this path — that's only for the
// callback route after a connect flow completes.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostBodySchema = z.object({
  company_id: dbUuid(),
  // When present, new bundle.social accounts that have no local DB row are
  // inserted and attributed to this company. The popup-close fallback path
  // (syncOnPopupClose in SocialConnectionsList) passes this so that
  // platforms whose OAuth redirects bundle.social's own dashboard instead
  // of our /callback URL (e.g. X/Twitter) still get a DB row created.
  // Omit for the manual "Refresh" UI action (should only update existing
  // rows, not create new ones without explicit user intent).
  attribute_new_to_company_id: dbUuid().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { company_id: uuid }.");
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_connections",
  );
  if (gate.kind === "deny") return gate.response;

  const result = await syncBundlesocialConnections({
    companyId: parsed.data.company_id,
    ...(parsed.data.attribute_new_to_company_id
      ? { attributeNewToCompanyId: parsed.data.attribute_new_to_company_id }
      : {}),
  });
  if (!result.ok) {
    return internalError(result.error.message);
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