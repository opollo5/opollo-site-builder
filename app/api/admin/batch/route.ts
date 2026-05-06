import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { createBatchJob } from "@/lib/batch-jobs";
import {
  conflict,
  internalError,
  notFound,
  readJsonBody,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

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

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("batch", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.trim() === "") {
    return validationError(
      "Idempotency-Key header is required. Every batch-create call must carry one so a retry cannot double-submit a billed job.",
    );
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
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
    logger.error("createBatchJob failed", { code: result.error.code });
    const { code, message, details } = result.error;
    switch (code) {
      case "VALIDATION_FAILED":
        return validationError(message, details);
      case "TEMPLATE_NOT_FOUND":
        return notFound(message);
      case "TEMPLATE_NOT_ACTIVE":
      case "IDEMPOTENCY_KEY_CONFLICT":
        return conflict(code, message, details);
      default:
        return internalError(message);
    }
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
