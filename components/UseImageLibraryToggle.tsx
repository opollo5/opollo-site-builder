"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export function UseImageLibraryToggle({
  siteId,
  initialEnabled,
  totalImages,
  imagesWithMetadata,
}: {
  siteId: string;
  initialEnabled: boolean;
  totalImages: number;
  imagesWithMetadata: number;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function commit(next: boolean) {
    setError(null);
    const previous = enabled;
    setEnabled(next);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/use-image-library`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { ok: false; error: { message: string } }
          | null;
        setError(payload?.error.message ?? `Failed (HTTP ${res.status}).`);
        setEnabled(previous);
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      setEnabled(previous);
    }
  }

  const metadataLabel =
    totalImages === 0
      ? "No images in the library yet."
      : imagesWithMetadata === totalImages
        ? `All ${totalImages} image${totalImages === 1 ? "" : "s"} have captions and alt text.`
        : `${imagesWithMetadata} of ${totalImages} image${totalImages === 1 ? "" : "s"} have captions and alt text.`;

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-4 rounded-md border bg-background p-3"
      data-testid="image-library-toggle-card"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Use images from the library</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When on, brief generation can suggest up to 5 images per page based
          on the page topic. Only images with caption and alt text are included.
        </p>
        <p
          className="mt-2 text-sm text-muted-foreground"
          data-testid="image-library-metadata-count"
        >
          {metadataLabel}{" "}
          {totalImages > 0 && imagesWithMetadata < totalImages && (
            <>
              Add captions via the{" "}
              <a
                href="/admin/images"
                className="underline underline-offset-2 hover:text-foreground"
              >
                image library
              </a>
              .
            </>
          )}
        </p>
        <a
          href="/admin/images"
          className="mt-2 inline-block text-sm underline underline-offset-2 hover:text-foreground"
          data-testid="image-library-view-link"
        >
          View image library →
        </a>
      </div>

      {/* Switch toggle — aria-role=switch makes the control unambiguous */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Use images from the library — ${enabled ? "on" : "off"}`}
        disabled={pending}
        onClick={() => startTransition(() => void commit(!enabled))}
        data-testid="use-image-library-toggle"
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
          "transition-colors duration-200 ease-in-out",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          enabled ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
            "transform transition-transform duration-200 ease-in-out",
            enabled ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>

      {error && (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
