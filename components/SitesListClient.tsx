"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { MenuProvider } from "@/components/SiteActionsMenu";
import { SitesTable } from "@/components/SitesTable";
import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type { SiteListItem } from "@/lib/tool-schemas";

// Client island for /admin/sites. The server component renders the
// initial list; this shell owns the "Add new site" CTA.
//
// AUTH-FOUNDATION P2.2: the modal-based AddSiteModal flow was
// replaced with a single-page guided form at /admin/sites/new (the
// guided flow needs the test-connection round-trip + capability
// check, which doesn't fit the snappy modal pattern). The "New site"
// button is now a Link.

export function SitesListClient({ sites }: { sites: SiteListItem[] }) {
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
            <Plus aria-hidden className="h-4 w-4" />
            New site
          </Link>
        </Button>
      </div>

      <div className="mt-4">
        <MenuProvider>
          <SitesTable
            sites={sites}
            onCreateClick={() => router.push("/admin/sites/new")}
          />
        </MenuProvider>
      </div>
    </>
  );
}
