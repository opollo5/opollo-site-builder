import { notFound, redirect } from "next/navigation";

import { SiteEditForm } from "@/components/SiteEditForm";
import { Alert } from "@/components/ui/alert";
import { TForm } from "@/templates";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getSite } from "@/lib/sites";

// AUTH-FOUNDATION P2.3 — /admin/sites/[id]/edit.
//
// Companion to /admin/sites/new. Same field layout, but seeds with the
// existing site's basics + WP user. Password renders as a placeholder
// "••••••••• (unchanged)" — empty submit preserves the stored value;
// a new value re-encrypts and replaces.

export const dynamic = "force-dynamic";

export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await getSite(params.id, { includeCredentials: true });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <TForm
        title="Edit site"
        breadcrumb={[
          { label: "Admin", href: "/admin/sites" },
          { label: "Sites", href: "/admin/sites" },
          { label: "Edit" },
        ]}
        formSections={[{
          content: (
            <Alert variant="destructive">{result.error.message}</Alert>
          ),
        }]}
      />
    );
  }

  const site = result.data.site;
  const creds = result.data.credentials;

  return (
    <TForm
      title="Edit site"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Sites", href: "/admin/sites" },
        { label: site.name, href: `/admin/sites/${site.id}` },
        { label: "Edit" },
      ]}
      subtitle="Update the basics or rotate the WordPress credentials. The Application Password stays as-is unless you enter a new one."
      formSections={[{
        content: (
          <SiteEditForm
            site={{
              id: site.id,
              name: site.name,
              wp_url: site.wp_url,
              wp_user: creds?.wp_user ?? "",
            }}
            hasStoredCredentials={creds !== null}
          />
        ),
      }]}
    />
  );
}
