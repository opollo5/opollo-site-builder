"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { AddSiteModal } from "@/components/AddSiteModal";
import { MenuProvider } from "@/components/SiteActionsMenu";
import { SitesTable } from "@/components/SitesTable";
import { Button } from "@/components/ui/button";
import { H1, Lead } from "@/components/ui/typography";
import type { SiteListItem } from "@/lib/tool-schemas";

// Client island for /admin/sites. The server component renders the
// initial list; this shell owns the "Add new site" button + modal
// state and refreshes the route on successful create via
// router.refresh(). Paired with the revalidatePath call inside
// /api/sites/register, the modal's success path is guaranteed to
// present the new row without a full-page reload.

export function SitesListClient({ sites }: { sites: SiteListItem[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

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
        <Button onClick={() => setModalOpen(true)} data-testid="add-site-button">
          <Plus aria-hidden className="h-4 w-4" />
          New site
        </Button>
      </div>

      <div className="mt-4">
        <MenuProvider>
          <SitesTable sites={sites} onCreateClick={() => setModalOpen(true)} />
        </MenuProvider>
      </div>

      <AddSiteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          // revalidatePath in /api/sites/register already busted the
          // page's cache; router.refresh() re-fetches the server
          // component tree so the new row appears immediately.
          router.refresh();
        }}
      />
    </>
  );
}
