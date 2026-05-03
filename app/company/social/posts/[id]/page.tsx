import { notFound, redirect } from "next/navigation";

import { PostApprovalSection } from "@/components/PostApprovalSection";
import { PostDecisionsAudit } from "@/components/PostDecisionsAudit";
import { PostPublishHistorySection } from "@/components/PostPublishHistorySection";
import { PostScheduleSection } from "@/components/PostScheduleSection";
import { PostVariantsSection } from "@/components/PostVariantsSection";
import { SocialPostDetailClient } from "@/components/SocialPostDetailClient";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import {
  listApprovalEvents,
  listRecipients,
} from "@/lib/platform/social/approvals";
import { getPostMaster } from "@/lib/platform/social/posts";
import { listPublishAttempts } from "@/lib/platform/social/publishing";
import { listScheduleEntries } from "@/lib/platform/social/scheduling";
import { listVariants } from "@/lib/platform/social/variants";
import { getServiceRoleClient } from "@/lib/supabase";

const PUBLISH_VISIBLE_STATES = new Set([
  "publishing",
  "published",
  "failed",
]);

const POST_DECISION_STATES = new Set([
  "approved",
  "rejected",
  "changes_requested",
]);

// ---------------------------------------------------------------------------
// S1-3 — customer post detail at /company/social/posts/[id].
//
// Server-rendered. Same gating as the list page:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//   3. Post not found in the user's company → next/notFound (returns 404).
//
// canDo("edit_post") drives the Edit / Delete affordances; the lib +
// route both enforce state='draft' on writes regardless.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanySocialPostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(
      `/login?next=${encodeURIComponent(`/company/social/posts/${id}`)}`,
    );
  }

  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Account not provisioned to a company.</p>
        <p className="mt-1 text-muted-foreground">
          Your account isn&apos;t a member of any company on the platform
          yet. Ask an admin to invite you, or contact Opollo support.
        </p>
      </div>
    );
  }

  const companyId = session.company.companyId;

  const [postResult, variantsResult, canEdit, canSubmit, canSchedule, canCreate, canRelease] =
    await Promise.all([
      getPostMaster({ postId: id, companyId }),
      listVariants({ postMasterId: id, companyId }),
      canDo(companyId, "edit_post"),
      canDo(companyId, "submit_for_approval"),
      canDo(companyId, "schedule_post"),
      canDo(companyId, "create_post"),
      canDo(companyId, "release_post"),
    ]);

  if (!postResult.ok) {
    if (postResult.error.code === "NOT_FOUND") notFound();
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load post: {postResult.error.message}
      </div>
    );
  }

  // Resolve the open approval_request (if any) so the recipients
  // section can render. Inlined here rather than wrapped in a lib
  // helper because it's the only consumer in V1; can lift to
  // lib/platform/social/approvals/get-open.ts when a second caller
  // appears.
  let approvalRequestId: string | null = null;
  let initialRecipients: Awaited<
    ReturnType<typeof listRecipients>
  > | null = null;
  const isPendingApproval = postResult.data.state === "pending_client_approval";
  if (isPendingApproval) {
    const svc = getServiceRoleClient();
    const open = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("post_master_id", postResult.data.id)
      .eq("company_id", companyId)
      .is("revoked_at", null)
      .is("final_approved_at", null)
      .is("final_rejected_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!open.error && open.data) {
      approvalRequestId = open.data.id as string;
      initialRecipients = await listRecipients({
        approvalRequestId,
        companyId,
      });
    }
  }

  // S1-8: when the post is in a post-decision state, surface the
  // audit trail of reviewer responses. Resolve the most recent
  // approval_request for the post (could be revoked, finalised, or
  // expired — any of those are valid for showing the audit).
  let auditEvents: Awaited<ReturnType<typeof listApprovalEvents>> | null = null;
  const isPostDecision = POST_DECISION_STATES.has(postResult.data.state);
  if (isPostDecision) {
    const svc = getServiceRoleClient();
    const lastRequest = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("post_master_id", postResult.data.id)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastRequest.error && lastRequest.data) {
      auditEvents = await listApprovalEvents({
        approvalRequestId: lastRequest.data.id as string,
        companyId,
      });
    }
  }

  return (
    <>
      <SocialPostDetailClient
        post={postResult.data}
        canEdit={canEdit}
        canSubmit={canSubmit}
        canCreate={canCreate}
        canRelease={canRelease}
      />
      {variantsResult.ok ? (
        <PostVariantsSection
          postId={postResult.data.id}
          companyId={companyId}
          initialResolved={variantsResult.data.resolved}
          masterText={variantsResult.data.masterText}
          canEdit={canEdit && postResult.data.state === "draft"}
        />
      ) : null}
      {isPendingApproval && initialRecipients?.ok ? (
        <PostApprovalSection
          postId={postResult.data.id}
          companyId={companyId}
          initialRecipients={initialRecipients.data.recipients}
          initialApprovalRequestId={approvalRequestId}
          canManage={canSubmit && isPendingApproval}
        />
      ) : null}
      {isPostDecision && auditEvents?.ok ? (
        <PostDecisionsAudit events={auditEvents.data.events} />
      ) : null}
      {postResult.data.state === "approved"
        ? await renderScheduleSection({
            postId: postResult.data.id,
            companyId,
            canSchedule,
          })
        : null}
      {PUBLISH_VISIBLE_STATES.has(postResult.data.state)
        ? await renderPublishHistorySection({
            postId: postResult.data.id,
            companyId,
            canRetry: canSchedule,
          })
        : null}
    </>
  );
}

async function renderPublishHistorySection(args: {
  postId: string;
  companyId: string;
  canRetry: boolean;
}) {
  const result = await listPublishAttempts({
    postMasterId: args.postId,
    companyId: args.companyId,
  });
  if (!result.ok) return null;
  return (
    <PostPublishHistorySection
      postId={args.postId}
      companyId={args.companyId}
      initialAttempts={result.data.attempts}
      canRetry={args.canRetry}
    />
  );
}

async function renderScheduleSection(args: {
  postId: string;
  companyId: string;
  canSchedule: boolean;
}) {
  const entries = await listScheduleEntries({
    postMasterId: args.postId,
    companyId: args.companyId,
  });
  if (!entries.ok) return null;
  return (
    <PostScheduleSection
      postId={args.postId}
      companyId={args.companyId}
      initialEntries={entries.data.entries}
      canSchedule={args.canSchedule}
    />
  );
}
