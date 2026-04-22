import Link from "next/link";

import { deliveryUrl } from "@/lib/cloudflare-images";
import type { ImageListItem } from "@/lib/image-library";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// M5-1 — images table (pure presentation).
//
// Thumbnails via deliveryUrl(cloudflare_id, 'public'). When the row
// lacks a cloudflare_id (pre-upload window during an ingest run) or
// when CLOUDFLARE_IMAGES_HASH is unset (dev environment without
// Cloudflare access), a placeholder tile renders instead.
//
// "Source" exposes the enum value directly — operators who reach the
// admin images surface understand the distinction between iStock-seed,
// manually-uploaded, and AI-generated rows. The raw `source_ref` stays
// off the list; it surfaces on the detail page (M5-2).
// ---------------------------------------------------------------------------

function formatDimensions(
  width: number | null,
  height: number | null,
): string {
  if (!width || !height) return "—";
  return `${width}×${height}`;
}

function sourceBadgeClass(source: string): string {
  switch (source) {
    case "istock":
      return "bg-sky-100 text-sky-900";
    case "upload":
      return "bg-amber-100 text-amber-900";
    case "generated":
      return "bg-purple-100 text-purple-900";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function Thumbnail({ item }: { item: ImageListItem }) {
  const url = item.cloudflare_id ? deliveryUrl(item.cloudflare_id) : null;
  const alt = item.alt_text ?? item.filename ?? "Library image";
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded bg-muted text-xs text-muted-foreground"
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
      className="h-12 w-12 rounded object-cover"
    />
  );
}

type ImagesTableProps = {
  items: ImageListItem[];
  /**
   * Serialised list state for the back-nav (e.g. "/admin/images?q=cat&page=2").
   * The detail page uses this as its "← Back to library" href so filters
   * survive a round-trip.
   */
  backHref?: string;
};

function buildDetailHref(id: string, backHref: string | undefined): string {
  if (!backHref || backHref === "/admin/images") return `/admin/images/${id}`;
  const params = new URLSearchParams({ from: backHref });
  return `/admin/images/${id}?${params.toString()}`;
}

export function ImagesTable({ items, backHref }: ImagesTableProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No images match these filters.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-16 px-4 py-2 font-medium">Preview</th>
            <th className="px-4 py-2 font-medium">Caption</th>
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
              <td className="px-4 py-3">
                <Thumbnail item={item} />
              </td>
              <td className="px-4 py-3 align-top">
                <Link
                  href={buildDetailHref(item.id, backHref)}
                  className="line-clamp-2 block max-w-md text-sm hover:underline"
                  data-testid="image-row-link"
                >
                  {item.caption ?? (
                    <span className="text-muted-foreground">
                      (no caption yet)
                    </span>
                  )}
                </Link>
                {item.filename && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.filename}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 align-top">
                <div className="flex flex-wrap gap-1">
                  {item.tags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    item.tags.slice(0, 6).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-2 py-0.5 text-xs"
                      >
                        {tag}
                      </span>
                    ))
                  )}
                  {item.tags.length > 6 && (
                    <span className="text-xs text-muted-foreground">
                      +{item.tags.length - 6}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 align-top">
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(item.source)}`}
                >
                  {item.source}
                </span>
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {formatDimensions(item.width_px, item.height_px)}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {formatRelativeTime(item.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
