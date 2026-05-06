"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { ImageLightbox } from "@/components/ImageLightbox";
import { StatusPill, imageSourceKind } from "@/components/ui/status-pill";
import { deliveryUrl } from "@/lib/cloudflare-images";
import type { ImageListItem } from "@/lib/image-library";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// M5-1 (updated) — images table with bulk hard-delete + lightbox.
// ---------------------------------------------------------------------------

function formatDimensions(width: number | null, height: number | null): string {
  if (!width || !height) return "—";
  return `${width}×${height}`;
}

type LightboxState = {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  tags: string[];
  width_px: number | null;
  height_px: number | null;
};

type ThumbnailProps = {
  item: ImageListItem;
  onClick?: () => void;
};

function Thumbnail({ item, onClick }: ThumbnailProps) {
  const url = item.cloudflare_id ? deliveryUrl(item.cloudflare_id) : null;
  const alt = item.alt_text ?? item.filename ?? "Library image";
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded bg-muted text-sm text-muted-foreground"
      >
        —
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={48}
      height={48}
      loading="lazy"
      onClick={onClick}
      className={`h-12 w-12 rounded object-cover${onClick ? " cursor-pointer" : ""}`}
      data-testid="image-thumbnail"
    />
  );
}

type ImagesTableProps = {
  items: ImageListItem[];
  backHref?: string;
};

function buildDetailHref(id: string, backHref: string | undefined): string {
  if (!backHref || backHref === "/admin/images") return `/admin/images/${id}`;
  const params = new URLSearchParams({ from: backHref });
  return `/admin/images/${id}?${params.toString()}`;
}

export function ImagesTable({ items, backHref }: ImagesTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function openLightbox(item: ImageListItem) {
    const url = item.cloudflare_id ? deliveryUrl(item.cloudflare_id) : null;
    if (!url) return;
    setLightbox({
      src: url,
      alt: item.alt_text ?? item.filename ?? "Library image",
      title: item.title,
      caption: item.caption,
      tags: item.tags,
      width_px: item.width_px,
      height_px: item.height_px,
    });
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(items.map((i) => i.id)));
    } else {
      setSelected(new Set());
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function executeBulkDelete() {
    setBulkError(null);
    const ids = Array.from(selected);
    const res = await fetch("/api/admin/images/bulk-hard-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const payload = await res.json().catch(() => null) as { ok: boolean; data?: { deleted: string[]; errors: Array<{ id: string; message: string }> } } | null;
    if (!res.ok || !payload?.ok) {
      setBulkError("Bulk delete failed. Please try again.");
      return;
    }
    if (payload.data && payload.data.errors.length > 0) {
      setBulkError(`${payload.data.errors.length} item(s) failed to delete.`);
    }
    setSelected(new Set());
    setBulkDeleteOpen(false);
    startTransition(() => router.refresh());
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No images match these filters.
        </p>
      </div>
    );
  }

  const allSelected = selected.size === items.length;
  const someSelected = selected.size > 0;

  return (
    <>
      {someSelected && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="rounded border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
            onClick={() => { setBulkError(null); setBulkDeleteOpen(true); }}
            data-testid="bulk-delete-button"
          >
            Delete permanently
          </button>
          {bulkError && (
            <p className="text-sm text-destructive" role="alert">{bulkError}</p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-sm uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="h-4 w-4 rounded border"
                  data-testid="select-all-checkbox"
                />
              </th>
              <th className="w-16 px-4 py-2 font-medium">Preview</th>
              <th className="px-4 py-2 font-medium">Title / Caption</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Dimensions</th>
              <th className="px-4 py-2 font-medium">Imported</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className="border-b last:border-b-0 hover:bg-muted/40"
                data-testid="image-row"
                data-image-id={item.id}
              >
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title ?? item.filename ?? item.id}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    className="h-4 w-4 rounded border"
                    data-testid="image-row-checkbox"
                  />
                </td>
                <td className="px-4 py-3">
                  <Thumbnail
                    item={item}
                    onClick={item.cloudflare_id ? () => openLightbox(item) : undefined}
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  <Link
                    href={buildDetailHref(item.id, backHref)}
                    className="line-clamp-2 block max-w-md text-sm hover:underline"
                    data-testid="image-row-link"
                  >
                    {item.title ?? item.caption ?? (
                      <span className="text-muted-foreground">
                        (no title yet)
                      </span>
                    )}
                  </Link>
                  {item.caption && item.title && (
                    <div className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {item.caption}
                    </div>
                  )}
                  {item.filename && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {item.filename}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {item.tags.length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      item.tags.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-2 py-0.5 text-sm"
                        >
                          {tag}
                        </span>
                      ))
                    )}
                    {item.tags.length > 6 && (
                      <span className="text-sm text-muted-foreground">
                        +{item.tags.length - 6}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <StatusPill kind={imageSourceKind(item.source)} />
                </td>
                <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                  {formatDimensions(item.width_px, item.height_px)}
                </td>
                <td className="px-4 py-3 align-top text-sm text-muted-foreground">
                  {formatRelativeTime(item.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          title={lightbox.title}
          caption={lightbox.caption}
          tags={lightbox.tags}
          width_px={lightbox.width_px}
          height_px={lightbox.height_px}
          onClose={() => setLightbox(null)}
        />
      )}

      <ConfirmActionModal
        open={bulkDeleteOpen}
        title={`Permanently delete ${selected.size} image${selected.size === 1 ? "" : "s"}?`}
        description="This removes the selected images from Cloudflare and Supabase. It cannot be undone."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        endpoint="/api/admin/images/bulk-hard-delete"
        request={{ method: "POST", body: { ids: Array.from(selected) } }}
        onClose={() => setBulkDeleteOpen(false)}
        onSuccess={() => {
          setSelected(new Set());
          setBulkDeleteOpen(false);
          startTransition(() => router.refresh());
        }}
      />
    </>
  );
}
