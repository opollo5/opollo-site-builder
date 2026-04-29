import { redirect } from "next/navigation";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteCreateForm } from "@/components/SiteCreateForm";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";

// AUTH-FOUNDATION P2.2 — /admin/sites/new.
//
// Single-page guided flow for adding a WordPress site. Replaces the
// modal-based AddSiteModal flow. Captures name + WP URL + WP user +
// Application Password; gates Save on a successful pre-save
// connection test (POST /api/sites/test-connection).

export const dynamic = "force-dynamic";

export default async function NewSitePage() {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs
        crumbs={[
          { label: "Sites", href: "/admin/sites" },
          { label: "New site" },
        ]}
      />
      <H1 className="mt-2">Add a WordPress site</H1>
      <Lead className="mt-1">
        Connect a site by providing its URL plus a WordPress Application
        Password. We&apos;ll verify the connection before storing the
        credentials.
      </Lead>

      <div className="mt-6">
        <SiteCreateForm />
      </div>
    </div>
  );
}
