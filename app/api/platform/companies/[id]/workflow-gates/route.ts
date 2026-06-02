import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, parseBodyWith, readJsonBody, validateUuidParam, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getGates, upsertGates, type UpsertGateInput } from "@/lib/platform/workflow";

// ---------------------------------------------------------------------------
// GET  /api/platform/companies/[id]/workflow-gates
// PUT  /api/platform/companies/[id]/workflow-gates
//
// Manage the three workflow gate configs for a company.
// Gate: manage_users (admin role) — mirrors the settings surface that owns gates.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATE_TYPES = ["copy_review", "image_review", "final_signoff"] as const;
const PASS_RULES = ["all_must", "any_one"] as const;

const ApproverSchema = z.object({
  platformUserId: z.string().uuid().optional(),
  externalEmail: z.string().email().optional(),
}).refine(
  (v) => v.platformUserId !== undefined || v.externalEmail !== undefined,
  { message: "Each approver must have either platformUserId or externalEmail." },
);

const GateInputSchema = z.object({
  gateType: z.enum(GATE_TYPES),
  enabled: z.boolean(),
  passRule: z.enum(PASS_RULES),
  timeoutDays: z.number().int().min(1).max(365),
  autoSchedule: z.boolean(),
  approvers: z.array(ApproverSchema).max(50),
});

const PutBodySchema = z
  .array(GateInputSchema)
  .min(1)
  .max(3)
  .refine(
    (gates) => {
      const types = gates.map((g) => g.gateType);
      return new Set(types).size === types.length;
    },
    { message: "Each gate_type may appear at most once." },
  );

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const uuidResult = validateUuidParam(id, "id");
  if (!uuidResult.ok) return uuidResult.response;
  const companyId = uuidResult.value;

  const gate = await requireCanDoForApi(companyId, "manage_users");
  if (gate.kind === "deny") return gate.response;

  try {
    const gates = await getGates(companyId);
    return NextResponse.json(
      { ok: true, data: { gates }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    logger.error("workflow.gates.route.get.failed", {
      company_id: companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return internalError("Failed to load workflow gates.");
  }
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const uuidResult = validateUuidParam(id, "id");
  if (!uuidResult.ok) return uuidResult.response;
  const companyId = uuidResult.value;

  const gate = await requireCanDoForApi(companyId, "manage_users");
  if (gate.kind === "deny") return gate.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(PutBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const gatesInput: UpsertGateInput[] = parsed.data;

  try {
    await upsertGates(companyId, gatesInput, gate.userId);
  } catch (err) {
    logger.error("workflow.gates.route.put.failed", {
      company_id: companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return internalError("Failed to save workflow gates.");
  }

  try {
    const gates = await getGates(companyId);
    return NextResponse.json(
      { ok: true, data: { gates }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    logger.error("workflow.gates.route.put.refetch_failed", {
      company_id: companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    // Write succeeded; return a minimal success if refetch fails.
    return NextResponse.json(
      { ok: true, data: { gates: [] }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }
}
