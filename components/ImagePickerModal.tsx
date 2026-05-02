"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Upload as UploadIcon, Search, Link2 } from "lucide-react";

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
// R1-5..8 — Image picker overhaul.
//
// Three tabs as a segmented control: Suggested / Browse / Upload.
//
//   • Suggested — opens by default when caller passes
//                 `suggestionContext` (composer's title + body) or
//                 `forPostId` (saved post). System fetches top-5
//                 FTS-ranked images from the library; if no context
//                 yet, falls back to recent uploads.
//   • Browse    — manual search via FTS query. Paginated grid.
//   • Upload    — drag-drop / pick a file (Cloudflare). Secondary
//                 "Or paste a URL" affordance below for the BP-6
//                 fetch path.
//
// Returns the selected ImagePickerEntry to the caller via onSelect.
// Modal closes immediately after selection.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 24;

export interface ImagePickerEntry extends ImageListItem {
  delivery_url: string | null;
}

interface ListResponse {
  ok: true;
  data: {
    items: ImagePickerEntry[];
    total: number;
    suggestion: { based_on: string | null; fallback_to_recent: boolean } | null;
  };
}

type Tab = "suggested" | "browse" | "upload";

interface ImagePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (image: ImagePickerEntry) => void;
  /** Saved post id — picker queries the suggest endpoint with this. */
  forPostId?: string | null;
  /**
   * Pre-save context (BlogPostComposer use case): composer concatenates
   * `${title} ${body-snippet-weighted-toward-title}` and passes it
   * here. Picker uses it to drive the Suggested tab without needing a
   * persisted post id.
   */
  suggestionContext?: string | null;
}

export function ImagePickerModal({
  open,
  onClose,
  onSelect,
  forPostId,
  suggestionContext,
}: ImagePickerModalProps) {
  const hasSuggestionSource =
    (forPostId !== undefined && forPostId !== null && forPostId.length > 0) ||
    (suggestionContext !== undefined &&
      suggestionContext !== null &&
      suggestionContext.length > 0);
  const [tab, setTab] = useState<Tab>(
    hasSuggestionSource ? "suggested" : "browse",
  );
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseItems, setBrowseItems] = useState<ImagePickerEntry[]>([]);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [suggestItems, setSuggestItems] = useState<ImagePickerEntry[]>([]);
  const [suggestBasedOn, setSuggestBasedOn] = useState<string | null>(null);
  const [suggestFallback, setSuggestFallback] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const browseInFlightRef = useRef<AbortController | null>(null);
  const suggestInFlightRef = useRef<AbortController | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setTab(hasSuggestionSource ? "suggested" : "browse");
    setBrowseQuery("");
    setBrowseItems([]);
    setBrowseTotal(0);
    setBrowseOffset(0);
    setBrowseError(null);
    setSuggestItems([]);
    setSuggestBasedOn(null);
    setSuggestFallback(false);
    setSuggestError(null);
  }, [open, hasSuggestionSource]);

  // Suggested tab fetch — runs on open + when context changes.
  useEffect(() => {
    if (!open || tab !== "suggested" || !hasSuggestionSource) return;
    const ctrl = new AbortController();
    if (suggestInFlightRef.current) suggestInFlightRef.current.abort();
    suggestInFlightRef.current = ctrl;

    void (async () => {
      setSuggestLoading(true);
      setSuggestError(null);
      try {
        const params = new URLSearchParams();
        if (forPostId) {
          params.set("for_post", forPostId);
        } else if (suggestionContext) {
          params.set("suggest_from", suggestionContext);
        }
        params.set("limit", "5");
        const res = await fetch(`/api/admin/images/list?${params}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (ctrl.signal.aborted) return;
        const payload = (await res.json().catch(() => null)) as
          | ListResponse
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (!payload?.ok) {
          setSuggestError(
            payload?.ok === false
              ? payload.error.message
              : `Failed to load suggestions (HTTP ${res.status}).`,
          );
          return;
        }
        setSuggestItems(payload.data.items);
        setSuggestBasedOn(payload.data.suggestion?.based_on ?? null);
        setSuggestFallback(
          payload.data.suggestion?.fallback_to_recent ?? false,
        );
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSuggestError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setSuggestLoading(false);
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [open, tab, hasSuggestionSource, forPostId, suggestionContext]);

  // Browse tab fetch — debounced on query / paginated on offset.
  useEffect(() => {
    if (!open || tab !== "browse") return;
    const ctrl = new AbortController();
    if (browseInFlightRef.current) browseInFlightRef.current.abort();
    browseInFlightRef.current = ctrl;

    const id = setTimeout(async () => {
      setBrowseLoading(true);
      setBrowseError(null);
      try {
        const params = new URLSearchParams();
        if (browseQuery.trim().length > 0) params.set("q", browseQuery.trim());
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(browseOffset));
        const res = await fetch(`/api/admin/images/list?${params}`, {
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (ctrl.signal.aborted) return;
        const payload = (await res.json().catch(() => null)) as
          | ListResponse
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (!payload?.ok) {
          setBrowseError(
            payload?.ok === false
              ? payload.error.message
              : `Failed to load images (HTTP ${res.status}).`,
          );
          return;
        }
        setBrowseItems((prev) =>
          browseOffset === 0
            ? payload.data.items
            : [...prev, ...payload.data.items],
        );
        setBrowseTotal(payload.data.total);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setBrowseError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctrl.signal.aborted) setBrowseLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [open, tab, browseQuery, browseOffset]);

  useEffect(() => {
    setBrowseOffset(0);
  }, [browseQuery]);

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
            Pick from suggestions, browse the full library, or upload a new
            image.
          </DialogDescription>
        </DialogHeader>

        {/* Segmented control: Suggested / Browse / Upload. */}
        <div
          role="tablist"
          aria-label="Image source"
          className="mt-2 inline-flex rounded-md border bg-muted/40 p-1 text-sm"
        >
          {hasSuggestionSource && (
            <SegmentedTab
              active={tab === "suggested"}
              onClick={() => setTab("suggested")}
              icon={Sparkles}
              testId="picker-tab-suggested"
            >
              Suggested
            </SegmentedTab>
          )}
          <SegmentedTab
            active={tab === "browse"}
            onClick={() => setTab("browse")}
            icon={Search}
            testId="picker-tab-browse"
          >
            Browse
          </SegmentedTab>
          <SegmentedTab
            active={tab === "upload"}
            onClick={() => setTab("upload")}
            icon={UploadIcon}
            testId="picker-tab-upload"
          >
            Upload
          </SegmentedTab>
        </div>

        {tab === "suggested" && (
          <SuggestedPanel
            loading={suggestLoading}
            error={suggestError}
            items={suggestItems}
            basedOn={suggestBasedOn}
            fallbackToRecent={suggestFallback}
            onSelect={handleSelect}
          />
        )}

        {tab === "browse" && (
          <div className="mt-4 space-y-3">
            <Input
              type="search"
              placeholder="Search by caption, alt, or filename"
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
              aria-label="Search images"
            />
            {browseError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
              >
                {browseError}
              </div>
            )}
            <ImageGrid items={browseItems} onSelect={handleSelect} />
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {browseTotal > 0
                  ? `Showing ${browseItems.length} of ${browseTotal}`
                  : browseLoading
                    ? "Loading…"
                    : "No images match."}
              </span>
              {browseItems.length < browseTotal && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBrowseOffset(browseItems.length)}
                  disabled={browseLoading}
                >
                  {browseLoading ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <UploadTab onUploaded={(image) => handleSelect(image)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function SuggestedPanel({
  loading,
  error,
  items,
  basedOn,
  fallbackToRecent,
  onSelect,
}: {
  loading: boolean;
  error: string | null;
  items: ImagePickerEntry[];
  basedOn: string | null;
  fallbackToRecent: boolean;
  onSelect: (image: ImagePickerEntry) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {fallbackToRecent ? (
          <>No post content yet — showing your recent uploads.</>
        ) : basedOn ? (
          <>
            Suggested for{" "}
            <span className="font-medium text-foreground">
              &ldquo;{basedOn}&rdquo;
            </span>
            . Click a thumbnail to select.
          </>
        ) : (
          <>
            Suggested based on the post content. Click a thumbnail to select.
          </>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square w-full rounded-md border bg-muted opollo-shimmer"
            />
          ))}
        </div>
      ) : (
        <>
          <ImageGrid
            items={items}
            onSelect={onSelect}
            colsClass="sm:grid-cols-3 md:grid-cols-5"
          />
          {!loading && items.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              No suggestions yet. Try Browse or Upload above.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function UploadTab({
  onUploaded,
}: {
  onUploaded: (image: ImagePickerEntry) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(
        `That file is ${Math.round(file.size / 1024 / 1024)} MB — over the 10 MB cap.`,
      );
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Pick a JPEG, PNG, GIF, or WebP image.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/images/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ImagePickerEntry }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        onUploaded(payload.data);
        return;
      }
      setError(
        payload?.ok === false
          ? payload.error.message
          : `Upload failed (HTTP ${res.status}).`,
      );
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-6 text-sm transition-smooth",
          dragActive ? "border-ring bg-muted/40" : "border-muted bg-muted/30",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        <p className="font-medium text-foreground">Upload an image</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag-drop a file here, or click the button below. JPEG / PNG /
          GIF / WebP. Max 10 MB. Captioning runs in the background.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Pick file"}
          </Button>
          {uploading && (
            <span className="text-sm text-muted-foreground">
              Pushing to Cloudflare…
            </span>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}
      </div>

      {/* R1-7 — secondary URL-paste affordance under the file picker.
          BP-6's URL fetch lives here as a sub-mode rather than its own
          tab (Steven's segmented control specced 3 tabs: Suggested /
          Browse / Upload). */}
      <UrlSubMode onFetched={onUploaded} />
    </div>
  );
}

function UrlSubMode({
  onFetched,
}: {
  onFetched: (image: ImagePickerEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFetch() {
    setError(null);
    if (!url.trim()) {
      setError("Paste an image URL.");
      return;
    }
    setFetching(true);
    try {
      const res = await fetch("/api/admin/images/fetch-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ImagePickerEntry }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        onFetched(payload.data);
        return;
      }
      setError(
        payload?.ok === false
          ? payload.error.message
          : `Fetch failed (HTTP ${res.status}).`,
      );
    } catch (err) {
      setError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setFetching(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="picker-url-disclosure"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
      >
        <Link2 aria-hidden className="h-3 w-3" />
        Or paste a URL instead
      </button>
    );
  }

  return (
    <div className="rounded-md border p-3 text-sm">
      {/* R2-fix — header row with a cancel affordance so the operator
          can collapse the disclosure if they opened it accidentally. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">Fetch image from URL</p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setUrl("");
            setError(null);
          }}
          aria-label="Cancel URL fetch"
          className="text-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Cancel
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Server fetches, validates type + size, and uploads to the library.
        30s timeout; 10 MB cap. Internal IPs blocked.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          type="url"
          inputMode="url"
          placeholder="https://example.com/image.jpg"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={fetching}
          data-testid="picker-url-input"
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleFetch}
          disabled={fetching}
          data-testid="picker-url-fetch"
        >
          {fetching ? "Fetching…" : "Fetch"}
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SegmentedTab({
  active,
  onClick,
  icon: Icon,
  testId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Sparkles;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      // R2-fix — focus-visible ring needs offset + z-index lift so it
      // doesn't clip against the segmented container's border or get
      // visually masked by neighbour tabs. ring-offset-2 +
      // ring-offset-background gives breathing room; relative z-10
      // lifts the focused tab above siblings.
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-smooth focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

function ImageGrid({
  items,
  onSelect,
  colsClass = "sm:grid-cols-3 md:grid-cols-4",
}: {
  items: ImagePickerEntry[];
  onSelect: (image: ImagePickerEntry) => void;
  colsClass?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      className={cn("grid grid-cols-2 gap-2", colsClass)}
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
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${img.delivery_url}/w=200,h=200,fit=cover`}
                  alt={img.alt_text ?? img.caption ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover transition-smooth group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  No preview
                </div>
              )}
            </div>
            {img.caption && (
              <p
                className="truncate px-2 py-1 text-sm text-muted-foreground"
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
