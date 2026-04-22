"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { UploadBriefModal } from "@/components/UploadBriefModal";

// Client shell that wraps the UploadBriefModal and exposes the button
// that opens it. Used by the site detail server component.
export function UploadBriefButton({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="upload-brief-button"
      >
        Upload brief
      </Button>
      <UploadBriefModal open={open} siteId={siteId} onClose={() => setOpen(false)} />
    </>
  );
}
