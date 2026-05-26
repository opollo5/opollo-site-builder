import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  checkPlatformRateLimit,
  platformRateLimitExceeded,
  platformRateLimitUnavailable,
} from "@/lib/platform/rate-limit";
import { parseCsv } from "@/lib/social/bulk-csv/parse";
import { internalError, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 1024 * 1024; // 1 MB

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts/bulk
//
// Multipart CSV upload. ALL-OR-NOTHING: if any row has a validation error,
// no rows are committed. Rate limit: 3/hour/company via Upstash + Postgres
// fallback.
//
// Requires `schedule_post` permission (approver+) because ALL rows are
// inserted with state='scheduled'. Editor-role users are intentionally
// blocked — they cannot bypass the scheduling gate via CSV upload.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId) return validationError("company_id query parameter is required.");

  const gate = await requireCanDoForApi(companyId, "schedule_post");
  if (gate.kind === "deny") return gate.response;

  // Rate limit: Upstash primary, Postgres fallback. Fail-closed.
  const rl = await checkPlatformRateLimit("csv_upload", `company:${companyId}`);
  if (!rl.ok) {
    if ("unavailable" in rl) return platformRateLimitUnavailable();
    return platformRateLimitExceeded(rl.retryAfterSec);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return validationError("Request must be multipart/form-data.");
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return validationError("Failed to parse multipart form data.");
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return validationError("Field 'file' is required.");
  }
  if (file.size > MAX_FILE_SIZE) {
    return validationError("File exceeds 1 MB limit.");
  }

  const csvText = await file.text();
  const { rows, errors } = parseCsv(csvText);

  if (errors.length > 0) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "CSV validation errors.", details: errors }, timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return validationError("CSV contains no data rows.");
  }

  const batchId = crypto.randomUUID();
  const svc = getServiceRoleClient();

  // Fetch all connected profile IDs for the company.
  const { data: connections } = await svc
    .from("social_connections")
    .select("id, platform")
    .eq("company_id", companyId)
    .is("disconnected_at", null);

  const connectionsByPlatform = new Map(
    (connections ?? []).map((c: Record<string, unknown>) => [String(c.platform), c.id as string]),
  );

  const draftsToInsert = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const targetProfileIds =
      row.channels.length === 0
        ? [...connectionsByPlatform.values()]
        : row.channels.map((ch) => connectionsByPlatform.get(ch)).filter(Boolean) as string[];

    // G8: If a row specifies channels but none resolve to a connected profile,
    // reject the entire upload (all-or-nothing) to prevent stuck-scheduled rows.
    if (targetProfileIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "UNRESOLVABLE_CHANNELS",
            message: `Row ${index + 1}: no channels could be resolved. Check the 'channels' column matches a connected platform (linkedin, facebook, x, gbp).`,
            details: [],
          },
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    // Combine date + time into an ISO 8601 scheduled_at.
    const scheduledAt = new Date(`${row.date}T${row.time}:00`).toISOString();

    draftsToInsert.push({
      company_id: companyId,
      created_by: gate.userId,
      updated_by: gate.userId,
      state: "scheduled" as const,
      content: row.content,
      media_urls: [] as string[],
      target_profiles: targetProfileIds.map((pid) => ({ profile_id: pid })),
      platform_variants: {} as Record<string, unknown>,
      scheduled_at: scheduledAt,
      approval_required: false,
      batch_id: batchId,
    });
  }

  const { error } = await svc.from("social_post_drafts").insert(draftsToInsert);

  if (error) {
    logger.error("bulk.insert_failed", { companyId, batchId, err: error.message });
    return internalError("Failed to create drafts.");
  }

  return NextResponse.json(
    { ok: true, data: { batch_id: batchId, count: rows.length }, timestamp: new Date().toISOString() },
    { status: 202 },
  );
}
