"use client";

import { useRouter } from "next/navigation";

import { MenuProvider } from "@/components/SiteActionsMenu";
import { SitesFilterChips } from "@/components/SitesFilterChips";
import { SitesTable } from "@/components/SitesTable";
import type { SiteSortColumn, SiteSortDir, ListSitesOptions } from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";

// Client island for /admin/sites. The server component renders the
// page chrome via PageHeader/PageShell; this shell owns the filter
// chip row + the table interactivity, and threads sort/filter URL
// state through to SitesTable.

export function SitesListClient({
  sites,
  filter,
  sort,
  dir,
  isSuperAdmin,
}: {
  sites: SiteListItem[];
  filter: ListSitesOptions["status"];
  sort: SiteSortColumn | null;
  dir: SiteSortDir | null;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();

  return (
    <>
      <SitesFilterChips activeFilter={filter} sort={sort} dir={dir} />

      <div className="mt-4">
        <MenuProvider>
          <SitesTable
            sites={sites}
            sort={sort}
            dir={dir}
            filter={filter}
            isSuperAdmin={isSuperAdmin}
            onCreateClick={() => router.push("/admin/sites/new")}
          />
        </MenuProvider>
      </div>
    </>
  );
}
