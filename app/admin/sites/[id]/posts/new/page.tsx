import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BlogPostComposer } from "@/components/BlogPostComposer";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getSite } from "@/lib/sites";

// /admin/sites/[id]/posts/new — BP-3 entry-point.
//
// Operator pastes / drops a post; smart-parser pre-fills metadata
// fields (BP-1); save-draft creates a draft post in the existing
// posts table. BP-4 (image picker) and BP-8 (run-start gate) layer on
// the featured-image flow + the Start-run CTA in later slices.

export const dynamic = "force-dynamic";

export default async function BlogPostEntryPage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await getSite(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-3xl">
        <Alert variant="destructive">{result.error.message}</Alert>
      </div>
    );
  }
  const site = result.data.site;

  return (
    <div className="mx-auto max-w-4xl">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Posts", href: `/admin/sites/${site.id}/posts` },
          { label: "New post" },
        ]}
      />
      <H1 className="mt-2">New blog post</H1>
      <Lead className="mt-1">
        Paste a markdown / HTML / YAML-fronted post. We&apos;ll parse the
        metadata into the fields below — every value is editable before you
        save the draft.
      </Lead>

      <div className="mt-6">
        <BlogPostComposer siteId={site.id} />
      </div>
    </div>
  );
}
