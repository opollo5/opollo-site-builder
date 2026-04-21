"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AddSiteModal } from "@/components/AddSiteModal";
import { SitesTable } from "@/components/SitesTable";
import { Button } from "@/components/ui/button";
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Manage sites</h1>
          <p className="text-sm text-muted-foreground">
            WordPress sites connected to this builder.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Add new site</Button>
      </div>

      <div className="mt-6">
        <SitesTable sites={sites} />
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
