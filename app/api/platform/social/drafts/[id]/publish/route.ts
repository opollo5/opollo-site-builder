import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";

import { dbUuid, internalError, invalidState, notFound, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  authenticateRequest,
  validateServiceActorCompany,
  recordServiceAction,
} from "@/lib/platform/auth/service-auth";
import { getDraft } from "@/lib/platform/social/drafts";
import {
  approvePost,
  createPostMaster,
  submitForApproval,
} from "@/lib/platform/social/posts";
import { listConnections } from "@/lib/platform/social/connections";
import { createScheduleEntry } from "@/lib/platform/social/scheduling";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";
import { upsertVariant } from "@/lib/platform/social/variants/upsert";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — single-call publish path from the composer.
//
// POST /api/platform/social/drafts/[id]/publish
//   Body: { company_id, mode: "post_now"|"schedule"|"draft" }
//
// Three modes:
//   draft     → save the post as a draft (state='draft'); archives the
//               draft row so it no longer shows in the composer on reload.
//   post_now  → create post + submit + auto-approve + schedule 2 min out.
//   schedule  → create post + submit + auto-approve + schedule at
//               draft_data.schedule.{date,times[0]}.
//
// Auto-approve is attempted with canDo("approve_post"). If the user
// lacks that permission, the post is left in 'pending_client_approval'
// and no schedule entry is created — the response body reflects the
// actual final state so the client can show the right confirmation.
//
// Gate: canDo("submit_for_approval") (editor+).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const BodySchema = z.object({
  company_id: dbUuid(),
  mode: z.enum(["post_now", "schedule", "draft"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: draftId } = await params;
  if (!UUID_RE.test(draftId)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, mode: 'post_now'|'schedule'|'draft' }.",
    );
  }

  const { company_id: companyId, mode } = parsed.data;

  // Auth: service key (CAP) or user session.
  const auth = await authenticateRequest(req);
  if (auth.kind === "deny") return auth.response;

  let userId: string;
  let hasApprovePermission: boolean;

  if (auth.kind === "service") {
    const companyCheck = await validateServiceActorCompany(companyId);
    if (!companyCheck.ok) return companyCheck.response;
    recordServiceAction(companyId, auth.actorId, {
      route: `POST /api/platform/social/drafts/${draftId}/publish`,
      mode,
    });
    userId = auth.actorId;
    // Service actors auto-approve (CAP manages the approval lifecycle itself).
    hasApprovePermission = true;
  } else {
    // For "draft" mode we only need create_post; for post/schedule we also
    // need submit_for_approval. Use the stricter gate to cover both paths.
    const gate = await requireCanDoForApi(companyId, "create_post");
    if (gate.kind === "deny") return gate.response;
    userId = gate.userId;
    const { canDo } = await import("@/lib/platform/auth");
    hasApprovePermission = await canDo(companyId, "approve_post");
  }

  // Load draft.
  const draftResult = await getDraft({ draftId, companyId });
  if (!draftResult.ok) {
    if (draftResult.error.code === "NOT_FOUND") return notFound(draftResult.error.message);
    return internalError(draftResult.error.message);
  }
  const draft = draftResult.data;
  const dd = draft.draft_data;

  if (!dd.master_text && !dd.link_url) {
    return invalidState("Post must have content (text or link URL) before publishing.");
  }

  // 1. Create post master.
  const postResult = await createPostMaster({
    companyId,
    masterText: dd.master_text || null,
    linkUrl: dd.link_url || null,
    sourceType: "manual",
    createdBy: userId,
  });
  if (!postResult.ok) {
    if (postResult.error.code === "VALIDATION_FAILED") return validationError(postResult.error.message);
    return internalError(postResult.error.message);
  }
  const post = postResult.data;

  // 2. Create variants for each selected connection.
  if (dd.target_connection_ids.length > 0) {
    const connectionsResult = await listConnections({ companyId });
    if (connectionsResult.ok) {
      const connMap = new Map(connectionsResult.data.connections.map((c) => [c.id, c]));
      await Promise.all(
        dd.target_connection_ids.map(async (connId) => {
          const conn = connMap.get(connId);
          if (!conn) return;
          await upsertVariant({
            postMasterId: post.id,
            companyId,
            platform: conn.platform,
            variantText: null,
            connectionId: conn.id,
          });
        }),
      );
    }
  }

  // Archive draft regardless of subsequent steps.
  const svc = getServiceRoleClient();
  await svc
    .from("social_post_drafts")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("company_id", companyId);

  // For "draft" mode, we're done.
  if (mode === "draft") {
    return NextResponse.json(
      { ok: true, data: { post, state: "draft", scheduled: false }, timestamp: new Date().toISOString() },
      { status: 201 },
    );
  }

  // 3. Submit for approval.
  const submitResult = await submitForApproval({ postId: post.id, companyId });
  if (!submitResult.ok) {
    // Return partial success — post was created but couldn't be submitted.
    return NextResponse.json(
      {
        ok: true,
        data: { post, state: "draft", scheduled: false, warning: submitResult.error.message },
        timestamp: new Date().toISOString(),
      },
      { status: 201 },
    );
  }

  // 4. Auto-approve unless the post explicitly requires a human approval step
  //    or the actor lacks approve_post permission.
  if (!hasApprovePermission || dd.approval_required) {
    return NextResponse.json(
      {
        ok: true,
        data: { post, state: "pending_client_approval", scheduled: false },
        timestamp: new Date().toISOString(),
      },
      { status: 201 },
    );
  }

  const approveResult = await approvePost({ postId: post.id, companyId });
  if (!approveResult.ok) {
    return NextResponse.json(
      {
        ok: true,
        data: { post, state: "pending_client_approval", scheduled: false, warning: approveResult.error.message },
        timestamp: new Date().toISOString(),
      },
      { status: 201 },
    );
  }

  // 5. Build list of scheduledAt timestamps.
  //    post_now = single entry 2 min from now.
  //    schedule = one entry per time in dd.schedule.times (multi-time support).
  //    Times entered in the composer are in the company's local timezone;
  //    convert to UTC using fromZonedTime.
  const { data: companyRow } = await svc
    .from("platform_companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();
  const companyTimezone = (companyRow?.timezone as string | null) ?? "UTC";

  const scheduledAts: string[] = [];
  if (mode === "post_now") {
    scheduledAts.push(new Date(Date.now() + 2 * 60 * 1000).toISOString());
  } else {
    // mode === "schedule"
    const times = dd.schedule?.times ?? [];
    if (!dd.schedule?.date || times.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          data: { post, state: "approved", scheduled: false, warning: "No schedule date/time set; post approved but not scheduled." },
          timestamp: new Date().toISOString(),
        },
        { status: 201 },
      );
    }
    for (const t of times) {
      // Convert from company local timezone to UTC.
      const localStr = `${dd.schedule.date}T${t}:00`;
      const utcDate = fromZonedTime(localStr, companyTimezone);
      const s = utcDate.toISOString();
      if (utcDate.getTime() <= Date.now()) {
        return invalidState(`Scheduled time ${t} must be in the future.`);
      }
      scheduledAts.push(s);
    }
  }

  // Resolve platforms from selected connections.
  const platformsToSchedule = new Set<string>();
  if (dd.target_connection_ids.length > 0) {
    const connectionsResult = await listConnections({ companyId });
    if (connectionsResult.ok) {
      for (const connId of dd.target_connection_ids) {
        const conn = connectionsResult.data.connections.find((c) => c.id === connId);
        if (conn) platformsToSchedule.add(conn.platform);
      }
    }
  }

  // Fallback: if no connections selected, default to linkedin_personal for demo purposes.
  if (platformsToSchedule.size === 0) platformsToSchedule.add("linkedin_personal");

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;

  // Create one entry per platform × time.
  const scheduleResults = await Promise.allSettled(
    Array.from(platformsToSchedule).flatMap((platform) =>
      scheduledAts.map((scheduledAt) =>
        createScheduleEntry({
          postMasterId: post.id,
          companyId,
          platform: platform as SocialPlatform,
          scheduledAt,
          scheduledBy: userId,
          origin,
        }),
      ),
    ),
  );

  const anyScheduled = scheduleResults.some(
    (r) => r.status === "fulfilled" && r.value.ok,
  );

  return NextResponse.json(
    {
      ok: true,
      data: {
        post,
        state: "approved",
        scheduled: anyScheduled,
        scheduledAt: anyScheduled ? scheduledAts[0] : null,
        scheduledAts: anyScheduled ? scheduledAts : [],
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
