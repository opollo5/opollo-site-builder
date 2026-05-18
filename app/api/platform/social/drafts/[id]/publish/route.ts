import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, invalidState, notFound, readJsonBody, validationError } from "@/lib/http";
import { canDo } from "@/lib/platform/auth";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
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

  // For "draft" mode we only need create_post; for post/schedule we also
  // need submit_for_approval. Use the stricter gate to cover both paths.
  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

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
    createdBy: gate.userId,
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
  //    or the user lacks approve_post permission.
  const canApprove = await canDo(companyId, "approve_post");
  if (!canApprove || dd.approval_required) {
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
      const s = `${dd.schedule.date}T${t}:00.000Z`;
      if (Date.parse(s) <= Date.now()) {
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
          scheduledBy: gate.userId,
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
