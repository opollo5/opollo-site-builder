"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ImageListItem } from "@/lib/image-library";

// ---------------------------------------------------------------------------
// BP-4 — Image picker modal.
//
// Three tabs:
//   • Library     — search the existing image_library (1,777 stock images
//                   today + every uploaded / fetched image). FTS via the
//                   /api/admin/images/list endpoint.
//   • Upload new  — stub. BP-5 wires multipart → Cloudflare Images.
//   • Paste URL   — stub. BP-6 wires server-side fetch + SSRF guard.
//
// Returns the selected ImagePickerEntry to the caller via onSelect.
// Modal closes immediately after selection.
//
// Wired into BlogPostComposer in this slice as the BP-3 placeholder's
// replacement; persistence + WP attachment land in BP-7.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 24;

export interface ImagePickerEntry extends ImageListItem {
  delivery_url: string | null;
}

type Tab = "library" | "upload" | "url";

interface ImagePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (image: ImagePickerEntry) => void;
}

export function ImagePickerModal({
  open,
  onClose,
  onSelect,
}: ImagePickerModalProps) {
  const [tab, setTab] = useState<Tab>("library");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ImagePickerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  // Reset state every time the modal opens so a re-open doesn't show
  // stale results from the previous session.
  useEffect(() => {
    if (!open) return;
    setTab("library");
    setQuery("");
    setItems([]);
    setTotal(0);
    setOffset(0);
    setError(null);
  }, [open]);

  // Debounced fetch on (open, tab=library, query, offset) change.
  useEffect(() => {
    if (!open || tab !== "library") return;
    const ctrl = new AbortController();
    if (inFlightRef.current) inFlightRef.current.abort();
    inFlightRef.current = ctrl;

    const id = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim().length > 0) params.set("q", query.trim());
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(offset));
        const res = await fetch(`/api/admin/images/list?${params}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (ctrl.signal.aborted) return;
        const payload = (await res.json().catch(() => null)) as
          | {
              ok: true;
              data: { items: ImagePickerEntry[]; total: number };
            }
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (!payload?.ok) {
          setError(
            payload?.ok === false
              ? payload.error.message
              : `Failed to load images (HTTP ${res.status}).`,
          );
          return;
        }
        // When offset === 0 the search/query changed — replace.
        // Otherwise it's "Load more" — append.
        setItems((prev) =>
          offset === 0 ? payload.data.items : [...prev, ...payload.data.items],
        );
        setTotal(payload.data.total);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [open, tab, query, offset]);

  // Reset offset to 0 whenever the search query changes, so paginating
  // through the previous query doesn't leak into the new one.
  useEffect(() => {
    setOffset(0);
  }, [query]);

  function handleSelect(image: ImagePickerEntry) {
    onSelect(image);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick a featured image</DialogTitle>
          <DialogDescription>
            Search the image library, upload a new image, or paste an image
            URL.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Image source" className="mt-2 flex gap-1 border-b">
          <TabButton active={tab === "library"} onClick={() => setTab("library")}>
            Library
          </TabButton>
          <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
            Upload new
          </TabButton>
          <TabButton active={tab === "url"} onClick={() => setTab("url")}>
            Paste URL
          </TabButton>
        </div>

        {tab === "library" && (
          <div className="mt-4 space-y-3">
            <Input
              type="search"
              placeholder="Search by caption, alt, or filename"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search images"
            />
            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <ImageGrid items={items} onSelect={handleSelect} />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {total > 0
                  ? `Showing ${items.length} of ${total}`
                  : loading
                    ? "Loading…"
                    : "No images match."}
              </span>
              {items.length < total && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOffset(items.length)}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <div className="mt-4 rounded-lg border-2 border-dashed border-muted bg-muted/30 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Upload coming in BP-5
            </p>
            <p className="mt-1">
              Drag-drop or pick a file to push it to Cloudflare Images, then
              auto-select it. For now, upload via the bulk-upload script and
              find your image in the Library tab.
            </p>
          </div>
        )}

        {tab === "url" && (
          <div className="mt-4 rounded-lg border-2 border-dashed border-muted bg-muted/30 p-6 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Paste-URL coming in BP-6
            </p>
            <p className="mt-1">
              Paste a public image URL — server fetches, runs SSRF guards,
              uploads to Cloudflare, and auto-selects.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-10 rounded-t-md px-3 text-sm font-medium transition-smooth",
        active
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ImageGrid({
  items,
  onSelect,
}: {
  items: ImagePickerEntry[];
  onSelect: (image: ImagePickerEntry) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4"
      role="grid"
      aria-label="Image library"
    >
      {items.map((img) => (
        <li key={img.id} role="gridcell">
          <button
            type="button"
            onClick={() => onSelect(img)}
            className={cn(
              "group block w-full overflow-hidden rounded-md border bg-muted text-left",
              "transition-smooth hover:border-ring hover:shadow-md",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
            aria-label={`Select ${img.caption ?? img.filename ?? img.id}`}
          >
            <div className="aspect-square w-full overflow-hidden">
              {img.delivery_url ? (
                // Cloudflare delivery URL with explicit w=/h=/fit= sizing.
                // Plain <img> avoids wiring imagedelivery.net into Next's
                // image-optimization pipeline for a 200×200 thumbnail.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${img.delivery_url}/w=200,h=200,fit=cover`}
                  alt={img.alt_text ?? img.caption ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover transition-smooth group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  No preview
                </div>
              )}
            </div>
            {img.caption && (
              <p
                className="truncate px-2 py-1 text-xs text-muted-foreground"
                title={img.caption}
              >
                {img.caption}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
