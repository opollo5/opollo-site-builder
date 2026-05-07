import { redirect } from "next/navigation";

import { SiteCreateForm } from "@/components/SiteCreateForm";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { checkAdminAccess } from "@/lib/admin-gate";

// AUTH-FOUNDATION P2.2 — /admin/sites/new.
//
// Single-page guided flow for adding a WordPress site. Captures name +
// WP URL + WP user + Application Password; gates Save on a successful
// pre-save connection test (POST /api/sites/test-connection).

export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Sites", href: "/admin/sites" },
            { label: "New site" },
          ]}
        />
        <PageHeader.Title>Add a WordPress site</PageHeader.Title>
        <PageHeader.Subtitle>
          Connect a site by providing its URL plus a WordPress Application
          Password. We&apos;ll verify the connection before storing the
          credentials.
        </PageHeader.Subtitle>
      </PageHeader>
      <div className="mx-auto max-w-2xl">
        <SiteCreateForm />
      </div>
    </PageShell>
  );
}
