"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  EditImageMetadataModal,
  type EditImageMetadataModalProps,
} from "@/components/EditImageMetadataModal";

// Thin client-side island that owns the modal open state. Keeps the
// detail page itself a pure Server Component.

export function EditImageMetadataButton({
  image,
}: {
  image: EditImageMetadataModalProps["image"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="edit-image-button"
      >
        Edit metadata
      </Button>
      <EditImageMetadataModal
        open={open}
        onClose={() => setOpen(false)}
        image={image}
      />
    </>
  );
}
