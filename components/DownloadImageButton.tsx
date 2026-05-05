"use client";

import { Button } from "@/components/ui/button";

export function DownloadImageButton({
  imageId,
  filename,
}: {
  imageId: string;
  filename: string | null;
}) {
  const href = `/api/admin/images/${imageId}/download`;
  return (
    <Button asChild variant="outline" size="sm" data-testid="image-download-button">
      <a href={href} download={filename ?? undefined} rel="noreferrer">
        Download
      </a>
    </Button>
  );
}
