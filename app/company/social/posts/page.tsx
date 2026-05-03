import { redirect } from "next/navigation";

import { SocialPostsListClient } from "@/components/SocialPostsListClient";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listPostMasters } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S1-2 — customer-facing social posts list at /company/social/posts.
//
// Server-rendered. Gates:
//   1. No session → /login.
//   2. No platform_users / no company membership → "Not provisioned".
//   3. Authenticated members (viewer+) get the list. Editor+ also get
//      the "New post" button (canDo "create_post"); viewers get a
//      read-only view.
//   4. Opollo staff land here too — they can see/manage every customer's
//      posts via the same surface (RLS allows + canDo passes for staff
//      via the is_opollo_staff override).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

export default async function CompanySocialPostsPage({ searchParams }: Props) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/posts")}`);
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
  const { q, page: pageParam } = await searchParams;
  const searchTerm = q?.trim() ?? "";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [postsResult, canCreate] = await Promise.all([
    listPostMasters({
      companyId,
      q: searchTerm || undefined,
      limit: PAGE_SIZE,
      offset,
      withCount: true,
    }),
    canDo(companyId, "create_post"),
  ]);

  if (!postsResult.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load posts: {postsResult.error.message}
      </div>
    );
  }

  return (
    <SocialPostsListClient
      companyId={companyId}
      initialPosts={postsResult.data.posts}
      canCreate={canCreate}
      initialQ={searchTerm}
      page={page}
      pageSize={PAGE_SIZE}
      totalCount={postsResult.data.totalCount}
    />
  );
}
