import { redirect, permanentRedirect } from "next/navigation";

import { NavIcon } from "@/components/ui/nav-icon";
import { checkAdminAccess } from "@/lib/admin-gate";
import { listSites } from "@/lib/sites";

// Blog section entry point. Three cases:
//   0 sites: "No sites" message.
//   1 site:  server-side redirect to /admin/posts/[siteId]/new — no flash.
//   2+ sites: "Select a site" empty state; rail SiteSelector drives navigation.

export const dynamic = "force-dynamic";

export default async function BlogEntryPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const result = await listSites();
  const sites = result.ok
    ? result.data.sites.filter((s) => s.status !== "pending_pairing")
    : [];

  if (sites.length === 1) {
    permanentRedirect(`/admin/posts/${sites[0]!.id}/new`);
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <NavIcon name="file-empty" size={36} className="text-tx-muted" />
      {sites.length === 0 ? (
        <>
          <p className="text-base font-medium">No sites available</p>
          <p className="max-w-xs text-sm text-tx-muted">
            Connect a WordPress install in{" "}
            <a href="/admin/sites" className="underline hover:text-foreground">
              Admin → Sites
            </a>{" "}
            before posting.
          </p>
        </>
      ) : (
        <>
          <p className="text-base font-medium">Select a site to continue</p>
          <p className="max-w-xs text-sm text-tx-muted">
            Use the site selector in the Blog navigation panel to choose a site,
            then navigate here again.
          </p>
        </>
      )}
    </div>
  );
}
