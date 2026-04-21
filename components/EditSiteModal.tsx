"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Name + WordPress URL edit. Credentials rotation lives in a separate
// slice — the encryption + password-display UX needs its own thinking
// pass and this modal keeps scope tight.

export function EditSiteModal({
  open,
  onClose,
  site,
}: {
  open: boolean;
  onClose: () => void;
  site: { id: string; name: string; wp_url: string };
}) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [wpUrl, setWpUrl] = useState(site.wp_url);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(site.name);
      setWpUrl(site.wp_url);
      setError(null);
      setSubmitting(false);
    }
  }, [open, site.name, site.wp_url]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !wpUrl.trim()) {
      setError("Both fields are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const patch: Record<string, string> = {};
    if (name !== site.name) patch.name = name;
    if (wpUrl !== site.wp_url) patch.wp_url = wpUrl;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      const res = await fetch(
        `/api/sites/${encodeURIComponent(site.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ?? `Update failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-site-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="edit-site-title" className="text-lg font-semibold">
          Edit site
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Credentials rotation has its own flow (coming in a follow-up
          slice).
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="es-name" className="block text-sm font-medium">
              Site name
            </label>
            <Input
              id="es-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="es-wp-url" className="block text-sm font-medium">
              WordPress URL
            </label>
            <Input
              id="es-wp-url"
              type="url"
              value={wpUrl}
              onChange={(e) => setWpUrl(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
