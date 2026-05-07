import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { PostsNewClient } from "@/components/PostsNewClient";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listSites } from "@/lib/sites";

// BL-1 — Top-level "Post a blog" entry point.
//
// Distinct from /admin/sites/[id]/posts/new (which lives inside a
// chosen site). This route lets an operator land directly from the
// sidebar, pick a site, and start drafting. The site picker is the
// first thing they see; the composer surfaces only after a site is
// chosen, which keeps the form from spelling out columns the operator
// hasn't decided on yet.

export const dynamic = "force-dynamic";

export default async function PostsNewPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await listSites();
  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb
            segments={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Post a blog" },
            ]}
          />
          <PageHeader.Title>Post a blog</PageHeader.Title>
        </PageHeader>
        <Alert variant="destructive">
          Failed to load sites: {result.error.message}
        </Alert>
      </PageShell>
    );
  }

  // Filter to sites the operator can actually publish into. Removed
  // sites are already excluded by listSites; we additionally drop
  // pending_pairing (no WP credentials yet) so the picker doesn't
  // present sites that will fail at publish time.
  const sites = result.data.sites.filter(
    (s) => s.status !== "pending_pairing",
  );

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Post a blog" },
          ]}
        />
        <PageHeader.Title>Post a blog</PageHeader.Title>
        <PageHeader.Subtitle>
          Pick a site, then paste or drop your post. Metadata pre-fills from
          front-matter, inline labels, or the first heading — every value is
          editable before save.
        </PageHeader.Subtitle>
      </PageHeader>
      <PostsNewClient sites={sites} />
    </PageShell>
  );
}
