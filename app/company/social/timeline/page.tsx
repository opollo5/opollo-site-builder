import { redirect } from "next/navigation";

import { SocialModuleShell } from "@/components/social/social-module-shell";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listPostMasters } from "@/lib/platform/social/posts";

import { TimelineFeed } from "./timeline-feed";

// ---------------------------------------------------------------------------
// Spec 22 PR 5 — /company/social/timeline
//
// Chronological feed of all posts (all states) sorted newest first.
// Viewer+ gate. Editor+ also sees "New post" CTA via composerEnabled.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Props = { searchParams: Promise<{ page?: string }> };

export default async function CompanySocialTimelinePage({ searchParams }: Props) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/timeline")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">No company context.</p>
      </div>
    );
  }

  const companyId = session.company.companyId;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [postsResult, canCreate] = await Promise.all([
    listPostMasters({
      companyId,
      limit: PAGE_SIZE,
      offset,
      withCount: true,
      sortBy: "created_at",
      sortDir: "desc",
    }),
    canDo(companyId, "create_post"),
  ]);

  const composerEnabled = process.env.FEATURE_COMPOSER_V2 !== "false";

  if (!postsResult.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load timeline: {postsResult.error.message}
      </div>
    );
  }

  return (
    <SocialModuleShell
      activeView="timeline"
      composerEnabled={composerEnabled && canCreate}
    >
      <TimelineFeed
        posts={postsResult.data.posts}
        totalCount={postsResult.data.totalCount}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </SocialModuleShell>
  );
}
