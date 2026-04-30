import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { logger } from "@/lib/logger";
import { recordChangeLog } from "@/lib/optimiser/change-log";
import { getServiceRoleClient } from "@/lib/supabase";

// POST /api/optimiser/pages/[id]/rollback — addendum §4.4 + §9.8.6.
//
// Rolls a managed page back to a target score-history version. Phase 1
// surface ships proposal-side bookkeeping: flip the relevant proposal
// to applied_then_reverted, log the rollback with staff actor id, and
// trigger a fresh score evaluation against the restored state. The
// actual Site Builder rollback endpoint call lands in Phase 1.5
// alongside brief submission.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  target_history_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Not authorised" },
      },
      { status: 401 },
    );
  }

  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: err instanceof Error ? err.message : "Invalid body",
        },
      },
      { status: 400 },
    );
  }

  const supabase = getServiceRoleClient();
  const { data: page } = await supabase
    .from("opt_landing_pages")
    .select("id, client_id, page_id")
    .eq("id", ctx.params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!page) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "NOT_FOUND", message: "Page not found" },
      },
      { status: 404 },
    );
  }

  const { data: target } = await supabase
    .from("opt_page_score_history")
    .select("id, page_version, triggering_proposal_id, evaluated_at, composite_score, classification")
    .eq("id", body.target_history_id)
    .eq("landing_page_id", ctx.params.id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Target version not found for this page",
        },
      },
      { status: 404 },
    );
  }

  // Flip the proposal that drove the version BEING ROLLED-BACK-FROM
  // (i.e. the most recent applied proposal for this page) to
  // applied_then_reverted. The target version's own triggering proposal
  // is preserved as historical truth.
  const { data: latestApplied } = await supabase
    .from("opt_proposals")
    .select("id, status")
    .eq("landing_page_id", ctx.params.id)
    .in("status", ["applied", "applied_promoted"])
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestApplied) {
    const { error: flipErr } = await supabase
      .from("opt_proposals")
      .update({
        status: "applied_then_reverted",
        updated_at: new Date().toISOString(),
        updated_by: access.user?.id ?? null,
      })
      .eq("id", latestApplied.id as string);
    if (flipErr) {
      logger.error("optimiser.rollback.flip_failed", {
        page_id: ctx.params.id,
        proposal_id: latestApplied.id,
        error: flipErr.message,
      });
    }
  }

  // Audit-trail row in opt_change_log. The Site Builder's existing
  // rollback endpoint call lands in Phase 1.5; for Phase 1 the log row
  // is the truth + the page snapshot stays where it is.
  await recordChangeLog({
    clientId: page.client_id as string,
    proposalId: (latestApplied?.id as string) ?? null,
    landingPageId: ctx.params.id,
    event: "manual_rollback",
    pageVersion: (target.page_version as string | null) ?? null,
    actorUserId: access.user?.id ?? null,
    details: {
      target_history_id: body.target_history_id,
      target_evaluated_at: target.evaluated_at,
      target_composite_score: target.composite_score,
      target_classification: target.classification,
      reverted_proposal_id: latestApplied?.id ?? null,
      reason: body.reason,
      // Phase 1 marker — Phase 1.5 will replace with brief_submission_id.
      site_builder_rollback_pending: true,
    },
  });

  // Re-evaluate the score so the cached current_composite_score on
  // opt_landing_pages reflects the restored state. Phase 1 ships the
  // restored composite from the target history row directly; the next
  // /api/cron/optimiser-evaluate-scores tick will reconcile if data
  // shifts.
  const { error: updateErr } = await supabase
    .from("opt_landing_pages")
    .update({
      current_composite_score: target.composite_score as number,
      current_classification: target.classification as string,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.params.id);
  if (updateErr) {
    logger.error("optimiser.rollback.score_update_failed", {
      page_id: ctx.params.id,
      error: updateErr.message,
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      page_id: ctx.params.id,
      restored_to: {
        history_id: target.id,
        composite_score: target.composite_score,
        classification: target.classification,
        evaluated_at: target.evaluated_at,
      },
    },
  });
}
