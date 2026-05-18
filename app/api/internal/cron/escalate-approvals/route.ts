import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { runEscalationCycle } from "@/lib/social/approval/escalate";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/internal/cron/escalate-approvals
// Schedule: 0 */6 * * * (every 6 hours)
//
// Runs the 48h / 72h / 96h escalation cycle for pending_approval drafts.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  try {
    const result = await runEscalationCycle();
    await updateHeartbeat("escalate-approvals", "ok");
    logger.info("escalate_approvals.done", result);
    return NextResponse.json({ ok: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("escalate_approvals.failed", { err: err instanceof Error ? err.message : String(err) });
    await updateHeartbeat("escalate-approvals", "error", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
