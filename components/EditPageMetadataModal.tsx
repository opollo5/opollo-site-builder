"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// M6-3 — page metadata edit modal.
//
// Edits title + slug on a pages row. Server-rendered detail page
// passes version_lock as a prop; the modal echoes it back as
// expected_version so the PATCH's optimistic lock can pin the UPDATE.
// UNIQUE_VIOLATION (slug collision) and VERSION_CONFLICT surface
// their server-side messages verbatim; the modal stays open so the
// operator doesn't lose their draft.
//
// Slug edit warning: renaming the slug here is a metadata-only
// operation. WP still serves the old URL until the next publish.
// ---------------------------------------------------------------------------

export type EditPageMetadataModalProps = {
  open: boolean;
  onClose: () => void;
  siteId: string;
  page: {
    id: string;
    title: string;
    slug: string;
    version_lock: number;
  };
};

export function EditPageMetadataModal({
  open,
  onClose,
  siteId,
  page,
}: EditPageMetadataModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(page.title);
      setSlug(page.slug);
      setError(null);
      setSubmitting(false);
    }
  }, [open, page.title, page.slug]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const patch: { title?: string; slug?: string } = {};
    const trimmedTitle = title.trim();
    const trimmedSlug = slug.trim();
    if (trimmedTitle !== page.title) patch.title = trimmedTitle;
    if (trimmedSlug !== page.slug) patch.slug = trimmedSlug;

    if (patch.title === undefined && patch.slug === undefined) {
      onClose();
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(page.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version: page.version_lock,
            patch,
          }),
        },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ??
            `Update failed (HTTP ${res.status}).`,
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

  const slugChanged = slug.trim() !== page.slug;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-page-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="edit-page-title" className="text-lg font-semibold">
          Edit page metadata
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Title and slug edits apply to our record. The WordPress-side
          content isn&apos;t republished automatically.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="ep-title"
              className="block text-sm font-medium"
            >
              Title
            </label>
            <Input
              id="ep-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              minLength={3}
              maxLength={160}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="ep-slug"
              className="block text-sm font-medium"
            >
              Slug
            </label>
            <Input
              id="ep-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={100}
              disabled={submitting}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              Lowercase letters, digits, and hyphens only.
            </p>
            {slugChanged && (
              <p
                className="mt-1 text-sm text-yellow-700"
                data-testid="slug-change-warning"
              >
                Changing the slug updates our record only — WordPress keeps
                the old URL until the next publish.
              </p>
            )}
          </div>
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="edit-page-error"
            >
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
