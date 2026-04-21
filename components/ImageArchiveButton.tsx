"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// M5-4 — archive / restore button for the image detail page.
//
// When the image is active (deleted_at is null), renders "Archive"
// which fires DELETE /api/admin/images/[id] after a browser confirm.
// IMAGE_IN_USE failures surface in-button rather than tripping a
// generic error toast — the message lists the referencing sites.
//
// When the image is already archived, renders "Restore" which POSTs
// /restore. No confirm needed; restore is non-destructive.
// ---------------------------------------------------------------------------

export function ImageArchiveButton({
  image,
}: {
  image: { id: string; deleted_at: string | null };
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isArchived = image.deleted_at !== null;

  async function handleArchive() {
    if (submitting) return;
    const confirmed = window.confirm(
      "Archive this image? It will disappear from the library and chat search. You can restore it from the archived view.",
    );
    if (!confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/images/${encodeURIComponent(image.id)}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `Archive failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function handleRestore() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/images/${encodeURIComponent(image.id)}/restore`,
        { method: "POST" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `Restore failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={isArchived ? handleRestore : handleArchive}
        disabled={submitting}
        data-testid={isArchived ? "restore-image-button" : "archive-image-button"}
      >
        {submitting
          ? "Working…"
          : isArchived
            ? "Restore"
            : "Archive"}
      </Button>
      {error && (
        <p
          role="alert"
          className="max-w-xs text-right text-xs text-destructive"
          data-testid="image-action-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
