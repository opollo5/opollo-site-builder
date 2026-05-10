"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { BulkImageUpload } from "@/components/BulkImageUpload";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import { cn } from "@/lib/utils";
import type { ImageLibrarySource, ImageListItem } from "@/lib/image-library";
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

type ImageListItemWithUrl = ImageListItem & { previewUrl: string | null };

export type ImagesFilterState = {
  query: string | null;
  tags: string[];
  source: ImageLibrarySource | null;
  deleted: boolean;
};

type ImagesTableProps = {
  items: ImageListItemWithUrl[];
  backHref?: string;
  filterState?: ImagesFilterState;
};

function buildDetailHref(id: string, backHref: string | undefined): string {
  if (!backHref || backHref === "/admin/images") return `/admin/images/${id}`;
  const params = new URLSearchParams({ from: backHref });
  return `/admin/images/${id}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Thumbnail — shared by list and grid views
// ---------------------------------------------------------------------------

function Thumbnail({
  item,
  onClick,
  className,
}: {
  item: ImageListItemWithUrl;
  onClick?: () => void;
  className?: string;
}) {
  const url = item.previewUrl;
  const alt = item.alt_text ?? item.filename ?? "Library image";
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded bg-muted text-sm text-muted-foreground",
          className ?? "h-12 w-12",
        )}
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
      loading="lazy"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "rounded object-cover",
        onClick && "cursor-pointer",
        className ?? "h-12 w-12",
      )}
      data-testid="image-thumbnail"
    />
  );
}

// ---------------------------------------------------------------------------
// TagsCell — list view
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GridCard — single card in grid view
// ---------------------------------------------------------------------------

function GridCard({
  item,
  selected,
  onSelect,
  onClick,
}: {
  item: ImageListItemWithUrl;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-md border bg-muted transition-colors",
        selected && "ring-2 ring-primary ring-offset-1",
      )}
      style={{ aspectRatio: "1" }}
      aria-label={item.title ?? item.filename ?? "Image"}
    >
      {/* Thumbnail fills the card */}
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.previewUrl}
          alt={item.alt_text ?? item.filename ?? "Library image"}
          loading="lazy"
          className="h-full w-full object-cover"
          data-testid="image-thumbnail"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          —
        </div>
      )}

      {/* Checkbox — top-left, always visible */}
      <div
        className="absolute left-1.5 top-1.5 z-10"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(!selected);
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => {
            e.stopPropagation();
            onSelect(e.target.checked);
          }}
          className="h-4 w-4 cursor-pointer accent-primary"
          aria-label={`Select ${item.title ?? item.filename ?? "image"}`}
        />
      </div>

      {/* Tag count badge — top-right, only when tags exist */}
      {item.tags.length > 0 && (
        <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-xs font-medium leading-none text-white">
          {item.tags.length}
        </div>
      )}

      {/* Gradient overlay — filename + dimensions */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1.5">
        <p className="truncate text-xs font-medium leading-tight text-white">
          {item.filename ?? item.title ?? "—"}
        </p>
        {item.width_px && item.height_px && (
          <p className="text-xs leading-tight text-white/70">
            {item.width_px}×{item.height_px}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGrid — grid view layout
// ---------------------------------------------------------------------------

function ImageGrid({
  items,
  selectedKeys,
  onSelectionChange,
  backHref,
}: {
  items: ImageListItemWithUrl[];
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  backHref: string | undefined;
}) {
  const router = useRouter();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <NavIcon name="picture" size={20} />
        <p className="text-sm">No images match these filters</p>
      </div>
    );
  }

  return (
    <div
      className="mt-3"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(149px, 1fr))",
        gap: "8px",
      }}
    >
      {items.map((item) => (
        <GridCard
          key={item.id}
          item={item}
          selected={selectedKeys.includes(item.id)}
          onSelect={(checked) => {
            if (checked) {
              onSelectionChange([...selectedKeys, item.id]);
            } else {
              onSelectionChange(selectedKeys.filter((k) => k !== item.id));
            }
          }}
          onClick={() => router.push(buildDetailHref(item.id, backHref))}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImagesToolbar — single-row toolbar (view toggle + filters + search)
// ---------------------------------------------------------------------------

function ImagesToolbar({
  view,
  onViewChange,
  filterState,
  showBulkUpload,
  onBulkUploadToggle,
}: {
  view: "grid" | "list";
  onViewChange: (v: "grid" | "list") => void;
  filterState: ImagesFilterState | undefined;
  showBulkUpload: boolean;
  onBulkUploadToggle: () => void;
}) {
  const toggleBtn =
    "flex h-8 w-8 items-center justify-center transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
      {/* View toggle — grid / list icon buttons in a bordered group */}
      <div className="flex divide-x divide-border overflow-hidden rounded border">
        <button
          type="button"
          onClick={() => onViewChange("grid")}
          aria-label="Grid view"
          aria-pressed={view === "grid"}
          className={cn(
            toggleBtn,
            view === "grid" ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          <NavIcon name="grid" size={16} />
        </button>
        <button
          type="button"
          onClick={() => onViewChange("list")}
          aria-label="List view"
          aria-pressed={view === "list"}
          className={cn(
            toggleBtn,
            view === "list" ? "bg-muted text-foreground" : "text-muted-foreground",
          )}
        >
          <NavIcon name="list" size={16} />
        </button>
      </div>

      {/* Filters + search as a single GET form */}
      <form
        method="GET"
        action="/admin/images"
        className="flex flex-1 flex-wrap items-center gap-2"
      >
        {/* Preserve deleted flag when archiving view is active */}
        {filterState?.deleted && (
          <input type="hidden" name="deleted" value="1" />
        )}

        {/* Preserve active tag filters as hidden inputs (tag dropdown is scaffolded below) */}
        {filterState?.tags.map((tag) => (
          <input key={tag} type="hidden" name="tag" value={tag} />
        ))}

        {/* Tag filter — scaffolded; needs tag enumeration API to implement */}
        {/* TODO: replace with a real dropdown once /api/admin/images/tags endpoint exists */}
        <select
          disabled
          className="h-8 rounded border bg-background px-2 text-sm text-muted-foreground opacity-60"
          aria-label="Tag filter (coming soon)"
        >
          <option>
            {filterState && filterState.tags.length > 0
              ? `${filterState.tags.length} tag${filterState.tags.length === 1 ? "" : "s"} active`
              : "All tags"}
          </option>
        </select>

        {/* Source filter — wired to `source` URL param */}
        <select
          name="source"
          defaultValue={filterState?.source ?? ""}
          className="h-8 rounded border bg-background px-2 text-sm"
          aria-label="Source"
        >
          <option value="">All sources</option>
          <option value="istock">iStock</option>
          <option value="upload">Upload</option>
          <option value="generated">Generated</option>
        </select>

        {/* Date filter — scaffolded; needs created_at range support in listImages */}
        {/* TODO: implement date range filter in listImages and wire this select */}
        <select
          disabled
          className="h-8 rounded border bg-background px-2 text-sm text-muted-foreground opacity-60"
          aria-label="Date filter (coming soon)"
        >
          <option>Any date</option>
        </select>

        {/* Bulk upload toggle — hidden in archived view */}
        {!filterState?.deleted && (
          <button
            type="button"
            onClick={onBulkUploadToggle}
            aria-expanded={showBulkUpload}
            className="flex h-8 items-center gap-1 rounded border bg-background px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Bulk upload {showBulkUpload ? "▴" : "▾"}
          </button>
        )}

        {/* Search — pushed to far right */}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={filterState?.query ?? ""}
            placeholder="Search images…"
            className="h-8 min-w-44 rounded-l border border-r-0 bg-background px-2 text-sm"
            aria-label="Search"
          />
          <button
            type="submit"
            className="flex h-8 w-8 items-center justify-center rounded-r border bg-background text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Apply search"
          >
            <NavIcon name="magnifier" size={14} />
          </button>
          {(filterState?.query ||
            (filterState?.tags?.length ?? 0) > 0 ||
            filterState?.source) && (
            <a
              href={
                filterState?.deleted
                  ? "/admin/images?deleted=1"
                  : "/admin/images"
              }
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </a>
          )}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImagesTable — main export; renders toolbar + grid or list view
// ---------------------------------------------------------------------------

export function ImagesTable({ items, backHref, filterState }: ImagesTableProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const [showBulkUpload, setShowBulkUpload] = useState(false);

  // View toggle — grid is the default; persisted in localStorage.
  // Initialised lazily on the client to avoid SSR/hydration mismatch.
  const [view, setView] = useState<"grid" | "list">("grid");
  useEffect(() => {
    const stored = localStorage.getItem("images-view");
    if (stored === "list" || stored === "grid") setView(stored);
  }, []);

  function handleViewChange(v: "grid" | "list") {
    setView(v);
    localStorage.setItem("images-view", v);
  }

  function openLightbox(item: ImageListItemWithUrl) {
    const url = item.previewUrl;
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

  const columns: ColumnDef<ImageListItemWithUrl>[] = [
    {
      key: "preview",
      header: "Preview",
      width: "64px",
      cell: (item) => (
        <Thumbnail
          item={item}
          onClick={item.previewUrl ? () => openLightbox(item) : undefined}
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
      <ImagesToolbar
        view={view}
        onViewChange={handleViewChange}
        filterState={filterState}
        showBulkUpload={showBulkUpload}
        onBulkUploadToggle={() => setShowBulkUpload((v) => !v)}
      />

      {showBulkUpload && !filterState?.deleted && (
        <div className="mt-2">
          <BulkImageUpload />
        </div>
      )}

      {selectedKeys.length > 0 && (
        <div className="mt-2 flex items-center gap-3">
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

      {view === "grid" ? (
        <ImageGrid
          items={items}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          backHref={backHref}
        />
      ) : (
        <div className="mt-3">
          <DataTable
            data={items}
            columns={columns}
            rowKey={(i) => i.id}
            selectable
            selectedKeys={selectedKeys}
            onSelectionChange={setSelectedKeys}
            onRowClick={(item: ImageListItemWithUrl) =>
              router.push(buildDetailHref(item.id, backHref))
            }
            testId="images-table"
            emptyState={{
              icon: <NavIcon name="picture" size={20} />,
              iconLabel: "No images",
              title: "No images match these filters",
              body: <>Adjust the filters above or upload an image to start.</>,
            }}
          />
        </div>
      )}

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
