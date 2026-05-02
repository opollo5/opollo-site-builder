"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// M5-3 — metadata edit modal.
//
// Lives on the detail page. Server-rendered props carry the current
// caption / alt / tags plus version_lock — the modal echoes
// expected_version back on submit so the server PATCH can pin the
// optimistic-locked UPDATE. On VERSION_CONFLICT we surface a
// deliberately specific message pointing the operator at "reload";
// the modal stays open so the user doesn't lose their draft.
// ---------------------------------------------------------------------------

export type EditImageMetadataModalProps = {
  open: boolean;
  onClose: () => void;
  image: {
    id: string;
    caption: string | null;
    alt_text: string | null;
    tags: string[];
    version_lock: number;
  };
};

function tagsToInputString(tags: string[]): string {
  return tags.join(", ");
}

function parseTagsInput(raw: string): string[] {
  const out = new Set<string>();
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim().toLowerCase();
    if (trimmed.length > 0) out.add(trimmed);
  }
  return Array.from(out);
}

export function EditImageMetadataModal({
  open,
  onClose,
  image,
}: EditImageMetadataModalProps) {
  const router = useRouter();
  const [caption, setCaption] = useState(image.caption ?? "");
  const [altText, setAltText] = useState(image.alt_text ?? "");
  const [tagsInput, setTagsInput] = useState(tagsToInputString(image.tags));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCaption(image.caption ?? "");
      setAltText(image.alt_text ?? "");
      setTagsInput(tagsToInputString(image.tags));
      setError(null);
      setSubmitting(false);
    }
  }, [open, image.caption, image.alt_text, image.tags]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const patch: {
      caption?: string | null;
      alt_text?: string | null;
      tags?: string[];
    } = {};

    const normalizedCaption = caption.trim();
    if (normalizedCaption !== (image.caption ?? "")) {
      patch.caption = normalizedCaption.length > 0 ? normalizedCaption : null;
    }
    const normalizedAlt = altText.trim();
    if (normalizedAlt !== (image.alt_text ?? "")) {
      patch.alt_text = normalizedAlt.length > 0 ? normalizedAlt : null;
    }
    const nextTags = parseTagsInput(tagsInput);
    const priorTags = image.tags.slice().sort().join(",");
    const nextTagsSorted = nextTags.slice().sort().join(",");
    if (priorTags !== nextTagsSorted) {
      patch.tags = nextTags;
    }

    if (
      patch.caption === undefined &&
      patch.alt_text === undefined &&
      patch.tags === undefined
    ) {
      // No-op — no diff to send.
      onClose();
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/images/${encodeURIComponent(image.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version: image.version_lock,
            patch,
          }),
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
      aria-labelledby="edit-image-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="edit-image-title" className="text-lg font-semibold">
          Edit image metadata
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Caption and alt text power search. Tags filter the admin browser and
          the chat tool.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="ei-caption"
              className="block text-sm font-medium"
            >
              Caption
            </label>
            <Textarea
              id="ei-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={500}
              rows={3}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="ei-alt"
              className="block text-sm font-medium"
            >
              Alt text
            </label>
            <Input
              id="ei-alt"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              maxLength={200}
              disabled={submitting}
            />
          </div>
          <div>
            <label
              htmlFor="ei-tags"
              className="block text-sm font-medium"
            >
              Tags
            </label>
            <Input
              id="ei-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="comma, separated, tags"
              disabled={submitting}
            />
            <p className="mt-1 text-sm text-muted-foreground">
              Up to 12 tags, max 40 characters each.
            </p>
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
