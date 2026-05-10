import { redirect, permanentRedirect } from "next/navigation";

import { NavIcon } from "@/components/ui/nav-icon";
import { PageHeader } from "@/components/ui/page-header";
import { checkAdminAccess } from "@/lib/admin-gate";

// Batches section entry point.
//
// Old URL /admin/batches?site_id=X is 308-redirected to /admin/batches/[siteId]
// so existing bookmarks still land in the right place.
//
// Without a site filter: show "Select a site" empty state; the SiteSelector
// in the rail drives navigation to /admin/batches/[siteId].

export const dynamic = "force-dynamic";

export default async function BatchesEntryPage({
  searchParams,
}: {
  searchParams: { site_id?: string };
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  // 308 redirect: ?site_id=X → /admin/batches/X (preserves old bookmarks)
  if (
    typeof searchParams.site_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(searchParams.site_id)
  ) {
    permanentRedirect(`/admin/batches/${searchParams.site_id}`);
  }

  return (
    <>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Batches" },
          ]}
        />
        <PageHeader.Title>Batches</PageHeader.Title>
      </PageHeader>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <NavIcon name="tree" size={36} className="text-tx-muted" />
        <p className="text-base font-medium">Select a site to continue</p>
        <p className="max-w-xs text-sm text-tx-muted">
          Use the site selector in the Batches navigation panel to choose a
          site, then navigate here again.
        </p>
      </div>
    </>
  );
}
