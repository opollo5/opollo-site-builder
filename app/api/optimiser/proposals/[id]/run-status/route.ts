import { NextResponse, type NextRequest } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { reconcileProposalRunStatus } from "@/lib/optimiser/site-builder-bridge/sync-proposal-status";

// OPTIMISER PHASE 1.5 SLICE 15 — GET /api/optimiser/proposals/[id]/run-status.
//
// Polled from the proposal review screen after approve. Reconciles
// the proposal status from the linked brief_run (lazy reconciliation
// pattern — no cron needed) and returns both states for the UI to
// render progress.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
  });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }

  try {
    const result = await reconcileProposalRunStatus(ctx.params.id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RECONCILE_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
