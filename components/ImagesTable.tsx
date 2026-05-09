"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import type { ImageListItem } from "@/lib/image-library";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 PR C — ImagesTable migration.
//
// Replaced bespoke <table> + inline StatusPill with the canonical
// DataTable. The bulk-delete surface (selection chip + Delete CTA +
// ConfirmActionModal) is preserved above the table; DataTable's
// `selectable` prop drives the per-row checkboxes.
//
// Visual contract:
//   - Preview                 → 48×48 thumbnail with optional lightbox.
//   - Title / Caption / File  → TableCell.Stack (title + filename
//                               as secondary). Caption renders as a
//                               second secondary line via flex.
//   - Tags                    → up to 6 Pill (neutral) chips inline,
//                               "+N" affordance for overflow.
//   - Source                  → Pill (info iStock, warning Upload,
//                               accent Generated).
//   - Dimensions              → TableCell.Mono (or Empty when null).
//   - Imported                → TableCell.Secondary (relative time).
// ---------------------------------------------------------------------------

const SOURCE_VARIANT: Record<ImageListItem["source"], PillVariant> = {
  istock: "info",
  upload: "warning",
  generated: "accent",
};

const SOURCE_LABEL: Record<ImageListItem["source"], string> = {
  istock: "iStock",
  upload: "Upload",
  generated: "Generated",
};

type LightboxState = {
  src: string;
  alt: string;
  title: string | null;
  caption: string | null;
  tags: string[];
  width_px: number | null;
  height_px: number | null;
};

type ImagesTableProps = {
  items: ImageListItem[];
  backHref?: string;
  cfHash: string | null;
};

function buildDetailHref(id: string, backHref: string | undefined): string {
  if (!backHref || backHref === "/admin/images") return `/admin/images/${id}`;
  const params = new URLSearchParams({ from: backHref });
  return `/admin/images/${id}?${params.toString()}`;
}

function Thumbnail({
  item,
  onClick,
  cfHash,
}: {
  item: ImageListItem;
  onClick?: () => void;
  cfHash: string | null;
}) {
  const url =
    item.cloudflare_id && cfHash
      ? `https://imagedelivery.net/${cfHash}/${item.cloudflare_id}/public`
      : null;
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
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`h-12 w-12 rounded object-cover${onClick ? " cursor-pointer" : ""}`}
      data-testid="image-thumbnail"
    />
  );
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <TableCell.Empty />;
  const visible = tags.slice(0, 6);
  const overflow = tags.length - visible.length;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((tag) => (
        <Pill key={tag} variant="neutral">
          {tag}
        </Pill>
      ))}
      {overflow > 0 && (
        <span className="text-sm text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}

export function ImagesTable({ items, backHref, cfHash }: ImagesTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function openLightbox(item: ImageListItem) {
    const url =
      item.cloudflare_id && cfHash
        ? `https://imagedelivery.net/${cfHash}/${item.cloudflare_id}/public`
        : null;
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

  const columns: ColumnDef<ImageListItem>[] = [
    {
      key: "preview",
      header: "Preview",
      width: "64px",
      cell: (item) => (
        <Thumbnail
          item={item}
          onClick={
            item.cloudflare_id ? () => openLightbox(item) : undefined
          }
          cfHash={cfHash}
        />
      ),
    },
    {
      key: "title",
      header: "Title / Caption",
      cell: (item) => (
        <TableCell.Stack
          primary={
            item.title ?? item.caption ?? (
              <span className="text-muted-foreground">(no title yet)</span>
            )
          }
          secondary={
            item.title && item.caption
              ? item.caption
              : item.filename ?? undefined
          }
        />
      ),
    },
    {
      key: "tags",
      header: "Tags",
      cell: (item) => <TagsCell tags={item.tags} />,
    },
    {
      key: "source",
      header: "Source",
      cell: (item) => (
        <Pill variant={SOURCE_VARIANT[item.source]}>
          {SOURCE_LABEL[item.source]}
        </Pill>
      ),
    },
    {
      key: "dimensions",
      header: "Dimensions",
      cell: (item) =>
        item.width_px && item.height_px ? (
          <TableCell.Mono>
            {item.width_px}×{item.height_px}
          </TableCell.Mono>
        ) : (
          <TableCell.Empty />
        ),
    },
    {
      key: "imported",
      header: "Imported",
      cell: (item) => (
        <TableCell.Secondary>
          {formatRelativeTime(item.created_at)}
        </TableCell.Secondary>
      ),
    },
  ];

  return (
    <>
      {selectedKeys.length > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {selectedKeys.length} selected
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => {
              setBulkError(null);
              setBulkDeleteOpen(true);
            }}
            data-testid="bulk-delete-button"
          >
            Delete permanently
          </Button>
          {bulkError && (
            <p className="text-sm text-destructive" role="alert">
              {bulkError}
            </p>
          )}
        </div>
      )}

      <DataTable
        data={items}
        columns={columns}
        rowKey={(i) => i.id}
        selectable
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        onRowClick={(item) => router.push(buildDetailHref(item.id, backHref))}
        testId="images-table"
        emptyState={{
          icon: <NavIcon name="picture" size={20} />,
          iconLabel: "No images",
          title: "No images match these filters",
          body: <>Adjust the filters above or upload an image to start.</>,
        }}
      />

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
        title={`Permanently delete ${selectedKeys.length} image${selectedKeys.length === 1 ? "" : "s"}?`}
        description="This removes the selected images from Cloudflare and Supabase. It cannot be undone."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        endpoint="/api/admin/images/bulk-hard-delete"
        request={{ method: "POST", body: { ids: selectedKeys } }}
        onClose={() => setBulkDeleteOpen(false)}
        onSuccess={() => {
          setSelectedKeys([]);
          setBulkDeleteOpen(false);
          startTransition(() => router.refresh());
        }}
      />
    </>
  );
}
