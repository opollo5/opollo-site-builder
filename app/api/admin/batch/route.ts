import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { createBatchJob } from "@/lib/batch-jobs";

// ---------------------------------------------------------------------------
// POST /api/admin/batch — M3-2.
//
// Creator endpoint for batch page-generation jobs. Admin + operator
// can invoke it; viewers cannot. The Idempotency-Key header is
// required — the batch generator spends money, so silent
// double-submission has to be impossible by construction. See
// lib/batch-jobs.ts for the replay / conflict semantics.
//
// This route does NOT kick the worker. It returns as soon as the
// job + slot rows are committed. M3-3 (worker core) picks them up
// via the cron tick or on-demand `waitUntil` invocation.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(details ?? {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function errorStatusFor(
  code: Awaited<ReturnType<typeof createBatchJob>>["ok"] extends true
    ? never
    : string,
): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "TEMPLATE_NOT_FOUND":
      return 404;
    case "TEMPLATE_NOT_ACTIVE":
      return 409;
    case "IDEMPOTENCY_KEY_CONFLICT":
      return 422;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.trim() === "") {
    return errorJson(
      "VALIDATION_FAILED",
      "Idempotency-Key header is required. Every batch-create call must carry one so a retry cannot double-submit a billed job.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorJson("VALIDATION_FAILED", "Body must be a JSON object.", 400);
  }
  const parsed = body as {
    site_id?: unknown;
    template_id?: unknown;
    slots?: unknown;
  };

  const result = await createBatchJob({
    site_id: typeof parsed.site_id === "string" ? parsed.site_id : "",
    template_id:
      typeof parsed.template_id === "string" ? parsed.template_id : "",
    slots: Array.isArray(parsed.slots)
      ? (parsed.slots as Array<{ inputs: Record<string, unknown> }>)
      : [],
    idempotency_key: idempotencyKey.trim(),
    created_by: gate.user?.id ?? null,
  });

  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      errorStatusFor(result.error.code),
      result.error.details,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: result.data.idempotency_replay ? 200 : 201 },
  );
}
