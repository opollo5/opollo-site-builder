import { notFound, redirect } from "next/navigation";

import { PostVariantsSection } from "@/components/PostVariantsSection";
import { SocialPostDetailClient } from "@/components/SocialPostDetailClient";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getPostMaster } from "@/lib/platform/social/posts";
import { listVariants } from "@/lib/platform/social/variants";

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

  const [postResult, variantsResult, canEdit] = await Promise.all([
    getPostMaster({ postId: id, companyId }),
    listVariants({ postMasterId: id, companyId }),
    canDo(companyId, "edit_post"),
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

  return (
    <>
      <SocialPostDetailClient post={postResult.data} canEdit={canEdit} />
      {variantsResult.ok ? (
        <PostVariantsSection
          postId={postResult.data.id}
          companyId={companyId}
          initialResolved={variantsResult.data.resolved}
          masterText={variantsResult.data.masterText}
          canEdit={canEdit && postResult.data.state === "draft"}
        />
      ) : null}
    </>
  );
}
