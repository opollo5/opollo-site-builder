"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { Button } from "@/components/ui/button";

type ImageDeleteButtonProps = {
  imageId: string;
  /** Where to redirect after successful delete. Defaults to /admin/images. */
  redirectTo?: string;
};

export function ImageDeleteButton({ imageId, redirectTo = "/admin/images" }: ImageDeleteButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="hard-delete-image-button"
      >
        Delete permanently
      </Button>

      <ConfirmActionModal
        open={open}
        title="Permanently delete image?"
        description="This removes the image from Cloudflare and Supabase. It cannot be undone. Any site that referenced this image will lose it."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        endpoint={`/api/admin/images/${imageId}/hard-delete`}
        request={{ method: "DELETE", searchParams: {} }}
        onClose={() => setOpen(false)}
        onSuccess={() => {
          setOpen(false);
          startTransition(() => router.push(redirectTo));
        }}
      />
    </>
  );
}
