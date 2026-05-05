"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

export function UseImageLibraryToggle({
  siteId,
  initialEnabled,
}: {
  siteId: string;
  initialEnabled: boolean;
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Use images from the library</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Suggest up to 5 captioned images per page based on the page title.
          Only images with caption + alt text are included; off by default
          until you&apos;ve verified the metadata quality.
        </p>
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 select-none">
        <span className="text-sm text-muted-foreground">
          {enabled ? "On" : "Off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Use images from the library"
          data-testid="use-image-library-toggle"
          onClick={() => startTransition(() => void commit(!enabled))}
          disabled={pending}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            enabled ? "bg-primary" : "bg-input",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
              enabled ? "translate-x-5" : "translate-x-0",
            )}
          />
        </button>
      </label>
      {error && (
        <p className="basis-full text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
