import { NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createDraft } from "@/lib/platform/social/drafts";
import { logger } from "@/lib/logger";
import { forbidden, internalError, readJsonBody, validationError } from "@/lib/http";

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts
//
// Creates a new blank social post draft. Requires "create_post" permission.
// Returns the new draft row with id + draft_version=1.
//
// Body: { company_id: string }
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

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const result = await createDraft({ companyId, userId: gate.userId });
  if (!result.ok) {
    logger.error("draft_create_failed", { company_id: companyId, error: result.error });
    return internalError(result.error.message, result.error.retryable);
  }

  return NextResponse.json(result, { status: 201 });
}
