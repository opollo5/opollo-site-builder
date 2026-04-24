import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PostDetailClient } from "@/components/PostDetailClient";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getPost } from "@/lib/posts";
import { preflightSitePublish } from "@/lib/site-preflight";
import { getSite } from "@/lib/sites";

// ---------------------------------------------------------------------------
// /admin/sites/[id]/posts/[post_id] — M13-4 detail.
//
// Server Component. Fetches post + site + runs the publish-time
// preflight (read-only, safe on every render). Passes the blocker (if
// any) to <PostDetailClient /> so the client can render the Publish
// button as disabled with a translated explanation when preflight
// fails, or enabled when preflight passes.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PostDetailPage({
  params,
}: {
  params: { id: string; post_id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.post_id)) {
    notFound();
  }

  const [siteRes, postRes] = await Promise.all([
    getSite(params.id),
    getPost(params.id, params.post_id),
  ]);

  if (!siteRes.ok) {
    if (siteRes.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load site: {siteRes.error.message}
      </div>
    );
  }
  if (!postRes.ok) {
    if (postRes.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load post: {postRes.error.message}
      </div>
    );
  }

  if (postRes.data.site_id !== params.id) notFound();

  const site = siteRes.data.site;
  const post = postRes.data;

  // Preflight is a read-only GET against WP /users/me. Safe on every
  // render. The client uses the blocker to decide whether to enable
  // Publish or render a translated "can't publish because…" panel.
  const preflight = await preflightSitePublish(params.id);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Posts", href: `/admin/sites/${site.id}/posts` },
          { label: post.title },
        ]}
      />
      <PostDetailClient
        siteId={site.id}
        siteWpUrl={site.wp_url}
        post={post}
        preflight={preflight}
      />
    </main>
  );
}
