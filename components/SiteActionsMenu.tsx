"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { EditSiteModal } from "@/components/EditSiteModal";

// Three-dot action menu attached to each site row. Opens in-place
// (no dropdown library — a small uncontrolled <details> keeps the
// dep surface minimal). Handles Edit + Archive.
//
// Clone Design System is deferred to a later slice — write-safety on
// cloning (idempotency key, copy-on-write vs reference semantics)
// needs its own thinking pass.

export function SiteActionsMenu({
  siteId,
  name,
  wpUrl,
}: {
  siteId: string;
  name: string;
  wpUrl: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <details
        className="group"
        onClick={(e) => e.stopPropagation()}
      >
        <summary
          className="cursor-pointer list-none rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          aria-label={`Actions for ${name}`}
          data-testid="site-actions-summary"
        >
          ⋯
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-background shadow-md">
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditOpen(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setArchiveOpen(true);
            }}
            data-testid="site-archive-action"
          >
            Archive
          </button>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-muted-foreground"
            title="Coming in a follow-up slice"
          >
            Clone DS (soon)
          </button>
        </div>
      </details>
      <EditSiteModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        site={{ id: siteId, name, wp_url: wpUrl }}
      />
      {archiveOpen && (
        <ConfirmActionModal
          open
          title={`Archive "${name}"?`}
          description="The site will be hidden from the list; its prefix is freed for reuse. Active generation batches are not cancelled automatically."
          confirmLabel="Archive"
          confirmVariant="destructive"
          endpoint={`/api/sites/${encodeURIComponent(siteId)}`}
          request={{ method: "DELETE", searchParams: {} }}
          onClose={() => setArchiveOpen(false)}
          onSuccess={() => {
            setArchiveOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
