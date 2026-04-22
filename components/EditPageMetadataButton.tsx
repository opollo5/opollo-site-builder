"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  EditPageMetadataModal,
  type EditPageMetadataModalProps,
} from "@/components/EditPageMetadataModal";

// Thin client island owning the edit-modal open state so the detail
// page can stay a Server Component.

export function EditPageMetadataButton({
  siteId,
  page,
}: {
  siteId: string;
  page: EditPageMetadataModalProps["page"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="edit-page-button"
      >
        Edit metadata
      </Button>
      <EditPageMetadataModal
        open={open}
        onClose={() => setOpen(false)}
        siteId={siteId}
        page={page}
      />
    </>
  );
}
