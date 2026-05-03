"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { UploadBriefModal } from "@/components/UploadBriefModal";

// Client shell that wraps the UploadBriefModal and exposes the button
// that opens it. Used by the site detail server component.
//
// UAT (2026-05-03) — bfcache busts the briefs-list staleness fix in
// UploadBriefModal (router.refresh() before push) when the operator
// browser-Backs from the review page. The browser restores the cached
// DOM from before the upload, so the new brief row is invisible until
// a hard reload. Listening for `pageshow.persisted === true` fires a
// client-side router.refresh() in that exact path. Adding the listener
// at the site-detail surface (not inside the modal) means it fires for
// any back-nav into the site page, not just back-from-review.
export function UploadBriefButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        router.refresh();
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

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
