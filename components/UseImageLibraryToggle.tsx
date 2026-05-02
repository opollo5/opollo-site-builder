"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

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
      <div>
        <p className="text-sm font-medium">Use images from the library</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Suggest up to 5 captioned images per page based on the page title.
          Only images with caption + alt text are included; off by default
          until you&apos;ve verified the metadata quality.
        </p>
      </div>
      <Button
        type="button"
        variant={enabled ? "default" : "outline"}
        onClick={() => startTransition(() => void commit(!enabled))}
        disabled={pending}
        data-testid="use-image-library-toggle"
        aria-pressed={enabled}
      >
        {enabled ? "Enabled" : "Disabled"}
      </Button>
      {error && (
        <p className="basis-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
