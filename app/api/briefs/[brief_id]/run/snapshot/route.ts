import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  estimateBriefRunCost,
  getBriefWithPages,
  type BriefPageRow,
  type BriefRow,
  type BriefRunSnapshot,
} from "@/lib/briefs";
import { validateUuidParam } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// RS-4 — GET /api/briefs/[brief_id]/run/snapshot
//
// Polled every 4s by the BriefRunClient via the lib/use-poll.ts hook.
// Returns the live state needed to drive the run surface without
// router.refresh()ing the whole page (and re-running every server
// component on the route).
//
// Shape:
//   {
//     ok: true,
//     data: {
//       brief: { id, status, version_lock, ... },
//       pages: BriefPageRow[],
//       active_run: BriefRunSnapshot | null,
//       remaining_budget_cents: number,
//       estimate_cents: number,
//     },
//     timestamp: ISO8601
//   }
//
// Auth: admin OR operator session (operator can drive runs end-to-end
// in M12; admin-only would lock them out of the live view they have a
// CTA for). Same role gate as the parent /run endpoint.
//
// Cache: no-store. Polling is the cache; never serve a stale row from
// a CDN or browser cache.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BriefRunSnapshotPayload {
  brief: BriefRow;
  pages: BriefPageRow[];
  active_run: BriefRunSnapshot | null;
  remaining_budget_cents: number;
  estimate_cents: number;
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { brief_id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const briefIdCheck = validateUuidParam(params.brief_id, "brief_id");
  if (!briefIdCheck.ok) return briefIdCheck.response;
  const briefId = briefIdCheck.value;

  const briefResult = await getBriefWithPages(briefId);
  if (!briefResult.ok) {
    return jsonNoStore(
      {
        ok: false,
        error: briefResult.error,
        timestamp: new Date().toISOString(),
      },
      briefResult.error.code === "NOT_FOUND" ? 404 : 500,
    );
  }

  const { brief, pages } = briefResult.data;
  const svc = getServiceRoleClient();

  const runRes = await svc
    .from("brief_runs")
    .select(
      "id, brief_id, status, current_ordinal, content_summary, run_cost_cents, failure_code, failure_detail, cancel_requested_at, started_at, finished_at, version_lock, created_at, updated_at",
    )
    .eq("brief_id", brief.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runRes.error) {
    logger.error("brief_run.snapshot.read_failed", {
      brief_id: brief.id,
      error: runRes.error.message,
    });
    return jsonNoStore(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to read run state.",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
  const activeRun = (runRes.data ?? null) as BriefRunSnapshot | null;

  const estimate = await estimateBriefRunCost(brief.id);

  const budget = await svc
    .from("tenant_cost_budgets")
    .select("monthly_cap_cents, monthly_usage_cents")
    .eq("site_id", brief.site_id)
    .maybeSingle();
  const cap = Number(budget.data?.monthly_cap_cents ?? 0);
  const usage = Number(budget.data?.monthly_usage_cents ?? 0);
  const remainingBudgetCents = Math.max(0, cap - usage);

  const data: BriefRunSnapshotPayload = {
    brief,
    pages,
    active_run: activeRun,
    remaining_budget_cents: remainingBudgetCents,
    estimate_cents: estimate.ok ? estimate.estimate_cents : 0,
  };

  return jsonNoStore(
    { ok: true, data, timestamp: new Date().toISOString() },
    200,
  );
}
