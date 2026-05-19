import { redirect } from "next/navigation";

import { SiteCreateForm } from "@/components/SiteCreateForm";
import { TForm } from "@/templates";
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
    <TForm
      title="Add a WordPress site"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Sites", href: "/admin/sites" },
        { label: "New site" },
      ]}
      subtitle="Connect a site by providing its URL plus a WordPress Application Password. We'll verify the connection before storing the credentials."
      formSections={[{ content: <SiteCreateForm /> }]}
    />
  );
}
