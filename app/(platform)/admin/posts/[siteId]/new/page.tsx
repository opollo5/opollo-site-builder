import { redirect } from "next/navigation";

import { PostsNewClient } from "@/components/PostsNewClient";
import { TForm } from "@/templates";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

export default async function PostsSiteNewPage({
  params,
}: {
  params: { siteId: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await listSites();
  const site = result.ok
    ? result.data.sites.find(
        (s) => s.id === params.siteId && s.status !== "pending_pairing",
      )
    : undefined;

  if (!site) {
    redirect("/admin/posts");
  }

  return (
    <TForm
      title="Post a blog"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Blog", href: "/admin/posts" },
        { label: site.name },
      ]}
      subtitle={`Paste or drop your post for ${site.name}. Metadata pre-fills from front-matter, inline labels, or the first heading — every value is editable before save.`}
      width="standard"
      formSections={[{
        content: <PostsNewClient siteId={site.id} siteName={site.name} />,
      }]}
    />
  );
}
