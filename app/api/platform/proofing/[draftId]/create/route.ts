import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createProof } from "@/lib/platform/proofing";
import { createStepProof } from "@/lib/platform/proofing/engine";
import { getWorkflowSteps } from "@/lib/platform/workflow/steps";

// ---------------------------------------------------------------------------
// POST /api/platform/proofing/[draftId]/create
//
// Opens a content_proof approval request for a V2 draft. Invites
// recipients via magic links and sends day-0 invite emails.
//
// Gate: submit_for_approval (editor+).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RecipientSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).nullable().optional(),
  requiresOtp: z.boolean().optional(),
});

const Schema = z.object({
  company_id: z.string().uuid(),
  approval_rule: z.enum(["any_one", "all_must"]).default("any_one"),
  recipients: z.array(RecipientSchema).min(1).max(20),
  expiry_days: z.number().int().min(1).max(90).optional(),
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

  const { company_id, approval_rule, recipients, expiry_days } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "submit_for_approval");
  if (gate.kind === "deny") return gate.response;

  try {
    // B3: if company has workflow_steps, use the step-based engine.
    // Otherwise fall back to B2's simple (explicit-recipient) flow.
    const steps = await getWorkflowSteps(company_id);

    if (steps.length > 0) {
      const result = await createStepProof({
        draftId,
        companyId: company_id,
        submitterUserId: gate.userId,
        origin: req.nextUrl.origin,
      });

      if (!result) return internalError("Failed to create step-based proof.");

      return NextResponse.json(
        { ok: true, data: result, timestamp: new Date().toISOString() },
        { status: 200 },
      );
    }

    // Simple flow (no workflow steps configured)
    const result = await createProof({
      draftId,
      companyId: company_id,
      submitterUserId: gate.userId,
      approvalRule: approval_rule,
      recipients: recipients.map((r) => ({
        email: r.email,
        name: r.name ?? null,
        requiresOtp: r.requiresOtp,
      })),
      expiryDays: expiry_days,
      origin: req.nextUrl.origin,
    });

    return NextResponse.json(
      { ok: true, data: result, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    logger.error("proofing.create.route_error", {
      draftId,
      company_id,
      err: String(err),
    });
    return internalError(String(err));
  }
}
