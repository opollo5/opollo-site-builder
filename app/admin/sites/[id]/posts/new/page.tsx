import { notFound, redirect } from "next/navigation";

import { BlogPostComposer } from "@/components/BlogPostComposer";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
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
    requiredRoles: ["super_admin", "admin"],
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
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Sites", href: "/admin/sites" },
            { label: site.name, href: `/admin/sites/${site.id}` },
            { label: "Posts", href: `/admin/sites/${site.id}/posts` },
            { label: "New post" },
          ]}
        />
        <PageHeader.Title>New blog post</PageHeader.Title>
        <PageHeader.Subtitle>
          Paste a markdown / HTML / YAML-fronted post. We&apos;ll parse the
          metadata into the fields below — every value is editable before you
          save the draft.
        </PageHeader.Subtitle>
      </PageHeader>
      <BlogPostComposer siteId={site.id} />
    </PageShell>
  );
}
