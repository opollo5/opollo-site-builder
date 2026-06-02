import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  getWorkflowSteps,
  upsertWorkflowSteps,
  type UpsertStepInput,
} from "@/lib/platform/workflow/steps";

// ---------------------------------------------------------------------------
// GET  /api/platform/companies/[id]/workflow-steps — list steps with participants
// PUT  /api/platform/companies/[id]/workflow-steps — replace the full step list
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: companyId } = await params;

  const gate = await requireCanDoForApi(companyId, "manage_connections"); // admin gate
  if (gate.kind === "deny") return gate.response;

  const steps = await getWorkflowSteps(companyId);
  return NextResponse.json(
    { ok: true, data: steps, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

const ParticipantSchema = z.object({
  platform_user_id: z.string().uuid().nullable().optional(),
  external_email: z.string().email().nullable().optional(),
  role: z.enum(["reviewer", "mandatory_reviewer", "gatekeeper", "approver"]),
});

const StepSchema = z.object({
  step_order: z.number().int().min(1),
  name: z.string().min(1).max(200),
  pass_rule: z.enum(["any_one", "all_must"]),
  timeout_days: z.number().int().min(1).max(90).optional(),
  participants: z.array(ParticipantSchema).max(50),
});

const PutSchema = z.object({
  steps: z.array(StepSchema).max(10),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: companyId } = await params;

  const gate = await requireCanDoForApi(companyId, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const result = await upsertWorkflowSteps(
    companyId,
    parsed.data.steps as UpsertStepInput[],
  );

  if (!result.ok) {
    return internalError(
      "Cannot update workflow steps while proofs are in progress. Complete or revoke open proofs first.",
    );
  }

  return NextResponse.json(
    { ok: true, data: result.steps, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
