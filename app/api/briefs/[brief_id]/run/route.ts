import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { estimateBriefRunCost, startBriefRun } from "@/lib/briefs";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M12-5 — run control surface.
//
//   GET  /api/briefs/[brief_id]/run
//     Returns the pre-flight estimate for the operator UI:
//       { estimate_cents, page_count, remaining_budget_cents }
//     No side effects. Used by the run-surface page to render the
//     confirmation dialog copy BEFORE the operator clicks start.
//
//   POST /api/briefs/[brief_id]/run
//     Body: { confirmed?: boolean }
//     Wraps lib/briefs.startBriefRun. Returns:
//       200 + { brief_run_id, estimate_cents, remaining_budget_cents }
//       429 + CONFIRMATION_REQUIRED when estimate > 50% remaining budget
//            (operator re-submits with confirmed: true to proceed)
//       409 + BRIEF_RUN_ALREADY_ACTIVE when a run is already in flight
//       400 + VALIDATION_FAILED for non-committed brief / malformed body
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StartRunBodySchema = z.object({
  confirmed: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!idCheck.ok) return idCheck.response;

  const estimate = await estimateBriefRunCost(idCheck.value);
  if (!estimate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: estimate.code, message: estimate.message, retryable: false },
        timestamp: new Date().toISOString(),
      },
      { status: estimate.code === "NOT_FOUND" ? 404 : 500 },
    );
  }

  // Also fetch remaining tenant budget so the UI can render the comparison.
  const svc = getServiceRoleClient();
  const briefLookup = await svc
    .from("briefs")
    .select("site_id")
    .eq("id", idCheck.value)
    .maybeSingle();
  const siteId = briefLookup.data?.site_id as string | undefined;
  let remainingBudgetCents = 0;
  if (siteId) {
    const budget = await svc
      .from("tenant_cost_budgets")
      .select("monthly_cap_cents, monthly_usage_cents")
      .eq("site_id", siteId)
      .maybeSingle();
    if (budget.data) {
      const cap = Number(budget.data.monthly_cap_cents ?? 0);
      const usage = Number(budget.data.monthly_usage_cents ?? 0);
      remainingBudgetCents = Math.max(0, cap - usage);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        estimate_cents: estimate.estimate_cents,
        page_count: estimate.page_count,
        remaining_budget_cents: remainingBudgetCents,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(
  req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(StartRunBodySchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await startBriefRun({
    briefId: idCheck.value,
    startedBy: gate.user?.id ?? null,
    confirmed: parsed.data.confirmed,
  });

  if (!result.ok) {
    logger.warn("briefs.run.start_failed", {
      brief_id: idCheck.value,
      code: result.error.code,
    });
    return respond(result);
  }

  // Bust the review + run surfaces so the post-start read sees the queued row.
  const svc = getServiceRoleClient();
  const lookup = await svc
    .from("briefs")
    .select("site_id")
    .eq("id", idCheck.value)
    .maybeSingle();
  const siteId = (lookup.data?.site_id as string | undefined) ?? null;
  if (siteId) {
    revalidatePath(`/admin/sites/${siteId}/briefs/${idCheck.value}/review`);
    revalidatePath(`/admin/sites/${siteId}/briefs/${idCheck.value}/run`);
    revalidatePath(`/admin/sites/${siteId}`);
  }

  return respond(result);
}
