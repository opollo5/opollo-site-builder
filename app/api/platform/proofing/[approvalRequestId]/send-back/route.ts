import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { sendBackStep } from "@/lib/platform/proofing/engine";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/proofing/[approvalRequestId]/send-back
//
// Gatekeeper send-back (B0 §5): revokes the current step's approval request
// and reopens the immediately prior step. The requesting user must be a
// gatekeeper participant in the current step.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  company_id: z.string().uuid(),
  recipient_id: z.string().uuid(),    // the gatekeeper's social_approval_recipients row
  comment: z.string().max(2000).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ approvalRequestId: string }> },
): Promise<NextResponse> {
  const { approvalRequestId } = await params;
  if (!approvalRequestId) return validationError("approvalRequestId is required.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const { company_id, recipient_id, comment } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "approve_post");
  if (gate.kind === "deny") return gate.response;

  // Look up the content_group_id from the approval request
  const svc = getServiceRoleClient();
  const { data: req_row } = await svc
    .from("social_approval_requests")
    .select("subject_id, company_id")
    .eq("id", approvalRequestId)
    .eq("company_id", company_id)
    .maybeSingle();

  if (!req_row) {
    return validationError("Approval request not found in this company.");
  }

  const contentGroupId = (req_row as { subject_id: string }).subject_id;

  const result = await sendBackStep({
    approvalRequestId,
    recipientId: recipient_id,
    companyId: company_id,
    contentGroupId,
    comment: comment ?? null,
    origin: req.nextUrl.origin,
  });

  if (!result.ok) {
    return validationError(
      "Send-back failed. Ensure you are a gatekeeper in this step and a prior step exists.",
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { priorStepName: result.priorStepName },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
