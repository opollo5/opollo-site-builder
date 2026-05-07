"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { MenuProvider } from "@/components/SiteActionsMenu";
import { SitesFilterChips } from "@/components/SitesFilterChips";
import { SitesTable } from "@/components/SitesTable";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { H1, Lead } from "@/components/ui/typography";
import type { SiteSortColumn, SiteSortDir, ListSitesOptions } from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";

// Client island for /admin/sites. The server component renders the
// initial list; this shell owns the "Add new site" CTA, the filter
// chip row, and threads sort/filter URL state through to SitesTable.

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Sites</H1>
          <Lead className="mt-0.5">
            {sites.length === 0
              ? "No WordPress sites connected yet."
              : `${sites.length} WordPress ${sites.length === 1 ? "site" : "sites"} connected to this builder.`}
          </Lead>
        </div>
        <Button asChild data-testid="add-site-button">
          <Link href="/admin/sites/new">
            <NavIcon name="plus" size={16} />
            New site
          </Link>
        </Button>
      </div>

      <div className="mt-4">
        <SitesFilterChips activeFilter={filter} sort={sort} dir={dir} />
      </div>

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
