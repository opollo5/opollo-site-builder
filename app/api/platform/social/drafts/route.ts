import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  authenticateRequest,
  validateServiceActorCompany,
  recordServiceAction,
} from "@/lib/platform/auth/service-auth";
import { createDraft } from "@/lib/platform/social/drafts";

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts
//
// Creates a new blank social post draft.
//
// Auth path A — user session (existing): requires "create_post" permission.
// Auth path B — service key (spec §2.2): x-platform-service-key +
//   x-platform-actor-id headers. Company must have cap_weekly_enabled = true.
//   Records a service_action_taken platform_events row.
//
// Body: { company_id: string, idempotency_key?: string }
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const body = await readJsonBody(req);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).company_id !== "string"
  ) {
    return validationError("company_id is required.");
  }

  const companyId = (body as Record<string, unknown>).company_id as string;
  const idempotencyKey =
    typeof (body as Record<string, unknown>).idempotency_key === "string"
      ? ((body as Record<string, unknown>).idempotency_key as string)
      : undefined;

  const auth = await authenticateRequest(req);
  if (auth.kind === "deny") return auth.response;

  let userId: string;

  if (auth.kind === "service") {
    const companyCheck = await validateServiceActorCompany(companyId);
    if (!companyCheck.ok) return companyCheck.response;
    recordServiceAction(companyId, auth.actorId, { route: "POST /api/platform/social/drafts" });
    userId = auth.actorId;
  } else {
    const gate = await requireCanDoForApi(companyId, "create_post");
    if (gate.kind === "deny") return gate.response;
    userId = gate.userId;
  }

  const result = await createDraft({ companyId, userId, idempotencyKey });
  if (!result.ok) {
    logger.error("draft_create_failed", { company_id: companyId, error: result.error });
    return internalError(result.error.message, result.error.retryable);
  }

  return NextResponse.json(result, { status: 201 });
}
