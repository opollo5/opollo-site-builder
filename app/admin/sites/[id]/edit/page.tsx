import { notFound, redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteEditForm } from "@/components/SiteEditForm";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getSite } from "@/lib/sites";

// AUTH-FOUNDATION P2.3 — /admin/sites/[id]/edit.
//
// Companion to /admin/sites/new. Same field layout, but seeds with the
// existing site's basics + WP user. Password renders as a placeholder
// "••••••••• (unchanged)" — empty submit preserves the stored value;
// a new value re-encrypts and replaces. Test connection without
// changing the password re-tests the stored credentials via the
// site_id mode of POST /api/sites/test-connection.

export const dynamic = "force-dynamic";

export default async function EditSitePage({
  params,
}: {
  params: { id: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  // Pull credentials for the WP-user pre-fill. The encrypted
  // app_password is dropped client-side; we never send it down.
  const result = await getSite(params.id, { includeCredentials: true });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="destructive">{result.error.message}</Alert>
      </div>
    );
  }

  const site = result.data.site;
  const creds = result.data.credentials;

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: site.name, href: `/admin/sites/${site.id}` },
          { label: "Edit" },
        ]}
      />
      <H1 className="mt-2">Edit site</H1>
      <Lead className="mt-1">
        Update the basics or rotate the WordPress credentials. The
        Application Password stays as-is unless you enter a new one.
      </Lead>

      <div className="mt-6">
        <SiteEditForm
          site={{
            id: site.id,
            name: site.name,
            wp_url: site.wp_url,
            wp_user: creds?.wp_user ?? "",
          }}
          hasStoredCredentials={creds !== null}
        />
      </div>
    </div>
  );
}
