import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import {
  getCapSubscriptionByCompany,
  createCapSubscription,
  type CapTier,
  type CapStatus,
} from "@/lib/cap/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const VALID_TIERS = new Set<CapTier>(["starter", "growth", "agency"]);
const VALID_STATUSES = new Set<CapStatus>(["trial", "active", "paused", "cancelled"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query param required.");
  }

  const sub = await getCapSubscriptionByCompany(companyId);
  return NextResponse.json({ ok: true, data: sub }, { status: 200 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return validationError("Request body must be JSON.");
  }

  const { company_id, tier, status, approval_required, monthly_cost_cap_usd } = body;

  if (typeof company_id !== "string" || !UUID_RE.test(company_id)) {
    return validationError("company_id must be a UUID.");
  }
  if (typeof tier !== "string" || !VALID_TIERS.has(tier as CapTier)) {
    return validationError("tier must be one of: starter, growth, agency.");
  }
  if (typeof status !== "string" || !VALID_STATUSES.has(status as CapStatus)) {
    return validationError("status must be one of: trial, active, paused, cancelled.");
  }

  try {
    const sub = await createCapSubscription({
      companyId: company_id,
      tier: tier as CapTier,
      status: status as CapStatus,
      approvalRequired: approval_required === true,
      monthlyCostCapUsd: typeof monthly_cost_cap_usd === "number" ? monthly_cost_cap_usd : 200,
    });
    return NextResponse.json({ ok: true, data: sub }, { status: 201 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to create subscription");
  }
}
