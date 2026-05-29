import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { autoAttachImage, type AutoAttachState } from "@/lib/image/auto-attach";

// ---------------------------------------------------------------------------
// /api/platform/image/jobs/[id]/select
//
// B4 — operator approves or rejects a single image-gen job result.
//
//   POST   → approve.  Body: { reason?: string }
//   PATCH  → reject.   Body: { reason: string }
//
// On approve: insert an image_selections row with selected=true, then if the
// job's target_publish_date is non-null, fire auto-attach. The auto-attach
// result is reflected in the response so the UI knows whether a draft was
// touched, but selection itself never fails on attach error.
//
// On reject: insert an image_selections row with selected=false +
// rejection_reason. No auto-attach side effect.
//
// Auth: requireCanDoForApi(companyId, "create_post") — editor+ on the
// company that owns the job.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ApproveBodySchema = z.object({ reason: z.string().max(500).optional() });
const RejectBodySchema = z.object({ reason: z.string().min(1).max(500) });

async function loadJobOwner(jobId: string): Promise<{ companyId: string } | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_generation_jobs")
    .select("company_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return { companyId: (data as { company_id: string }).company_id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return handleSelection(req, params.id, /* approve */ true);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  return handleSelection(req, params.id, /* approve */ false);
}

async function handleSelection(
  req: NextRequest,
  jobId: string,
  approve: boolean,
): Promise<NextResponse> {
  const owner = await loadJobOwner(jobId);
  if (!owner) return validationError("Job not found.", { jobId });

  const gate = await requireCanDoForApi(owner.companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const body = (await readJsonBody(req)) ?? {};
  const parsed = approve
    ? ApproveBodySchema.safeParse(body)
    : RejectBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request body.", { issues: parsed.error.issues });
  }

  const svc = getServiceRoleClient();

  // Insert the selection row. Both approve and reject paths write here.
  const reason = approve
    ? (parsed.data as { reason?: string }).reason ?? null
    : (parsed.data as { reason: string }).reason;

  const { data: selection, error: selErr } = await svc
    .from("image_selections")
    .insert({
      job_id: jobId,
      selected: approve,
      selected_by: gate.userId,
      rejection_reason: approve ? null : reason,
    })
    .select("id")
    .single();

  if (selErr || !selection) {
    logger.error("image.select.insert_failed", {
      jobId,
      approve,
      err: selErr?.message,
    });
    return internalError("Failed to record selection.");
  }

  // Reject: done. No attach side-effect.
  if (!approve) {
    logger.info("image.select.rejected", { jobId, reason });
    return NextResponse.json({
      ok: true,
      data: {
        jobId,
        selected: false,
        selectionId: (selection as { id: string }).id,
        rejectionReason: reason,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Approve: fire auto-attach. Result is reflected in the response so the
  // UI can render an "attached to draft on YYYY-MM-DD" affordance. The
  // attach is fail-soft — selection has already been recorded.
  let attachResult: { state: AutoAttachState; draftId?: string; assetId?: string; error?: string };
  try {
    attachResult = await autoAttachImage({
      jobId,
      companyId: owner.companyId,
      approvedBy: gate.userId,
    });
  } catch (err) {
    // autoAttachImage is designed not to throw; this is a defence-in-depth
    // log for the impossible case.
    logger.warn("image.select.auto_attach_threw", {
      jobId,
      err: err instanceof Error ? err.message : String(err),
    });
    attachResult = { state: "attach_failed", error: "auto_attach threw" };
  }

  logger.info("image.select.approved", {
    jobId,
    companyId: owner.companyId,
    attachState: attachResult.state,
  });

  return NextResponse.json({
    ok: true,
    data: {
      jobId,
      selected: true,
      selectionId: (selection as { id: string }).id,
      autoAttach: attachResult,
    },
    timestamp: new Date().toISOString(),
  });
}
