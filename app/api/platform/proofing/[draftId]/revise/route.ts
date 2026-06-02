import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { reviseProof } from "@/lib/platform/proofing";

// ---------------------------------------------------------------------------
// POST /api/platform/proofing/[draftId]/revise
//
// Creates a new version of a proof (same content_group_id, version+1,
// supersedes_id pointing to the old draft). Archives the current version.
//
// Gate: submit_for_approval (editor+). The operator is creating a new
// version to address reviewer feedback.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  company_id: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
): Promise<NextResponse> {
  const { draftId } = await params;
  if (!draftId) return validationError("draftId is required.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const { company_id } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "submit_for_approval");
  if (gate.kind === "deny") return gate.response;

  try {
    const result = await reviseProof({
      draftId,
      companyId: company_id,
      revisedByUserId: gate.userId,
    });

    return NextResponse.json(
      { ok: true, data: result, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    logger.error("proofing.revise.route_error", {
      draftId,
      company_id,
      err: String(err),
    });
    return internalError(String(err));
  }
}
