"use client";

import * as React from "react";
import { Upload, ImageIcon, Sparkles, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { logClientError } from "@/lib/errors/logClientError";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// MediaPickerModal — Phase 5.1 / C2
// Three tabs: Upload (drag-drop) | Library (5-col grid from social_media_assets)
// | AI generate (Ideogram, 4 variations, 1:1).
//
// onAttach is called with the chosen source URLs then the modal closes.
// ---------------------------------------------------------------------------

type MediaAsset = {
  id: string;
  source_url: string | null;
  mime_type: string;
  bytes: number;
  scope: "company" | "global";
  created_at: string;
};

type Tab = "upload" | "library" | "ai";
type TypeFilter = "all" | "image" | "gif";

const MAX_FILES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/gif,image/webp";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export interface MediaPickerModalProps {
  open: boolean;
  onClose: () => void;
  onAttach: (urls: string[]) => void;
  companyId: string;
  draftBody?: string;
  currentMediaCount?: number;
}

export function MediaPickerModal({
  open,
  onClose,
  onAttach,
  companyId,
  draftBody = "",
  currentMediaCount = 0,
}: MediaPickerModalProps) {
  const [tab, setTab] = React.useState<Tab>("upload");

  // Upload tab
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // Library tab
  const [assets, setAssets] = React.useState<MediaAsset[]>([]);
  const [libLoading, setLibLoading] = React.useState(false);
  const [libError, setLibError] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all");
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const libFetchedRef = React.useRef(false);

  // AI tab
  const [aiPrompt, setAiPrompt] = React.useState(draftBody);
  const [generating, setGenerating] = React.useState(false);
  const [generated, setGenerated] = React.useState<{ id: string; url: string }[]>([]);
  const [selectedGenId, setSelectedGenId] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState<string | null>(null);

  // Reset all state on open
  React.useEffect(() => {
    if (open) {
      setTab("upload");
      setDragging(false);
      setUploading(false);
      setUploadError(null);
      setSelectedIds(new Set());
      setTypeFilter("all");
      setGenerated([]);
      setSelectedGenId(null);
      setAiError(null);
      setAiPrompt(draftBody);
      setAssets([]);
      setNextCursor(null);
      libFetchedRef.current = false;
    }
  }, [open, draftBody]);

  // Fetch library on first visit to the Library tab
  React.useEffect(() => {
    if (tab === "library" && !libFetchedRef.current) {
      libFetchedRef.current = true;
      void fetchLibrary();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function fetchLibrary(cursor?: string) {
    setLibLoading(true);
    setLibError(null);
    try {
      const params = new URLSearchParams({ company_id: companyId });
      if (cursor) params.set("before", cursor);
      const res = await fetch(`/api/platform/social/media/image-library?${params.toString()}`);
      const json = (await res.json()) as {
        ok: boolean;
        data?: { assets: MediaAsset[]; next_cursor: string | null };
      };
      if (json.ok && json.data) {
        const newAssets = json.data.assets;
        const newCursor = json.data.next_cursor;
        if (cursor) {
          setAssets((prev) => [...prev, ...newAssets]);
        } else {
          setAssets(newAssets);
        }
        setNextCursor(newCursor);
      } else {
        setLibError("Failed to load media library.");
      }
    } catch {
      setLibError("Network error loading library.");
    } finally {
      setLibLoading(false);
    }
  }

  async function uploadFiles(files: FileList) {
    const remaining = MAX_FILES - currentMediaCount;
    if (files.length > remaining) {
      setUploadError(`Can only add ${remaining} more image${remaining === 1 ? "" : "s"}.`);
      return;
    }
    setUploadError(null);
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const traceId = crypto.randomUUID();
      if (!ACCEPTED_TYPES.has(file.type)) {
        setUploadError(`${file.name} is not a supported format (JPEG, PNG, GIF, WebP). [trace: ${traceId}]`);
        setUploading(false);
        return;
      }
      if (file.size > MAX_BYTES) {
        setUploadError(`${file.name} exceeds the 8 MB limit. [trace: ${traceId}]`);
        setUploading(false);
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("company_id", companyId);
      const res = await fetch("/api/platform/social/media/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        const msg = json.error?.message ?? "Upload failed.";
        setUploadError(`${msg} [trace: ${traceId}]`);
        void logClientError({
          component: "media-picker-upload",
          severity: "error",
          message: msg,
          traceId,
          companyId,
          context: { error_code: "MEDIA_UPLOAD_FAILED", http_status: res.status },
        });
        setUploading(false);
        return;
      }
      const json = (await res.json()) as { ok: boolean; data: { asset: { source_url: string } } };
      newUrls.push(json.data.asset.source_url);
    }
    setUploading(false);
    onAttach(newUrls);
    onClose();
  }

  async function generateAiImages() {
    if (!aiPrompt.trim()) {
      setAiError("Enter a prompt to generate images.");
      return;
    }
    setGenerating(true);
    setAiError(null);
    setGenerated([]);
    setSelectedGenId(null);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        fetch("/api/platform/social/cap/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            prompt: aiPrompt.trim(),
            aspect_ratio: "ASPECT_1_1",
          }),
        })
          .then(
            (r) =>
              r.json() as Promise<{
                ok: boolean;
                data?: { asset: { id: string; source_url: string } };
              }>,
          )
          .then((json) => {
            if (json.ok && json.data?.asset) return json.data.asset;
            throw new Error("Generation failed");
          }),
      ),
    );

    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<{ id: string; source_url: string }> =>
          r.status === "fulfilled",
      )
      .map((r) => ({ id: r.value.id, url: r.value.source_url }));

    if (successful.length === 0) {
      setAiError("Image generation failed. Make sure IDEOGRAM_API_KEY is configured.");
    } else {
      setGenerated(successful);
    }
    setGenerating(false);
  }

  function toggleLibrarySelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const canAdd = MAX_FILES - currentMediaCount - next.size;
        if (canAdd <= 0) return prev;
        next.add(id);
      }
      return next;
    });
  }

  function handleUseLibrarySelection() {
    const urls = assets
      .filter((a) => selectedIds.has(a.id) && a.source_url)
      .map((a) => a.source_url!);
    onAttach(urls);
    onClose();
  }

  function handleUseAiSelection() {
    const item = generated.find((g) => g.id === selectedGenId);
    if (!item) return;
    onAttach([item.url]);
    onClose();
  }

  const filteredAssets = assets.filter((a) => {
    if (typeFilter === "image") return a.mime_type.startsWith("image/") && a.mime_type !== "image/gif";
    if (typeFilter === "gif") return a.mime_type === "image/gif";
    return true;
  });

  const slotsRemaining = MAX_FILES - currentMediaCount;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden" data-testid="media-picker-modal">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>Add media</DialogTitle>
        </DialogHeader>

        {/* Tab switcher */}
        <div className="flex border-b border-border px-6 mt-4">
          {(["upload", "library", "ai"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`media-picker-tab-${t}`}
            >
              {t === "upload" ? "Upload" : t === "library" ? "Library" : "AI generate"}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[320px] max-h-[420px] overflow-y-auto px-6 py-4">
          {/* ---- Upload tab ---- */}
          {tab === "upload" && (
            <div className="flex flex-col items-center justify-center h-full min-h-[280px]">
              <div
                role="region"
                aria-label="Drop zone"
                data-testid="media-upload-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
                }}
                onClick={() => uploadInputRef.current?.click()}
                className={cn(
                  "w-full rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                <Upload
                  size={32}
                  className="mx-auto mb-3 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-sm font-medium text-foreground mb-1">
                  {uploading ? "Uploading…" : "Drop files here or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, GIF, WebP · max 8 MB · up to {slotsRemaining} image
                  {slotsRemaining === 1 ? "" : "s"}
                </p>
              </div>
              {uploadError && (
                <p className="mt-3 text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                className="sr-only"
                data-testid="media-picker-file-input"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void uploadFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
            </div>
          )}

          {/* ---- Library tab ---- */}
          {tab === "library" && (
            <div>
              {/* Filter row */}
              <div className="flex items-center gap-2 mb-4">
                <div className="relative">
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                    className="text-xs border border-border rounded-md px-2 py-1.5 pr-6 bg-white focus:outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                    aria-label="Filter by type"
                    data-testid="media-library-type-filter"
                  >
                    <option value="all">All types</option>
                    <option value="image">Images</option>
                    <option value="gif">GIFs</option>
                  </select>
                  <ChevronDown
                    size={10}
                    className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                </div>
                {selectedIds.size > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {selectedIds.size} selected
                  </span>
                )}
              </div>

              {libLoading && assets.length === 0 && (
                <div
                  className="flex items-center justify-center h-48"
                  data-testid="media-library-loading"
                >
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              )}

              {libError && (
                <p className="text-xs text-destructive text-center py-8">{libError}</p>
              )}

              {!libLoading && !libError && filteredAssets.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center h-48 text-center"
                  data-testid="media-library-empty"
                >
                  <ImageIcon size={32} className="text-muted-foreground mb-2" aria-hidden />
                  <p className="text-sm text-muted-foreground">
                    No images in the library yet.
                  </p>
                </div>
              )}

              {filteredAssets.length > 0 && (
                <div
                  className="grid grid-cols-5 gap-2"
                  data-testid="media-library-grid"
                >
                  {filteredAssets.map((asset) => {
                    const isSelected = selectedIds.has(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleLibrarySelection(asset.id)}
                        data-testid={`media-library-item-${asset.id}`}
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          isSelected
                            ? "border-primary"
                            : "border-transparent hover:border-primary/40",
                        )}
                        aria-pressed={isSelected}
                        aria-label={`Select image ${asset.id}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.source_url ?? ""}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        {isSelected && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <div className="rounded-full bg-primary p-0.5">
                              <Check size={12} className="text-white" aria-hidden />
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {nextCursor && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => void fetchLibrary(nextCursor)}
                    disabled={libLoading}
                    className="text-xs text-primary hover:underline disabled:opacity-50"
                    data-testid="media-library-load-more"
                  >
                    {libLoading ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---- AI generate tab ---- */}
          {tab === "ai" && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ai-image-prompt"
                  className="text-xs font-medium text-foreground block mb-1.5"
                >
                  Describe the image you want
                </label>
                <textarea
                  id="ai-image-prompt"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Professional product photo on white background…"
                  rows={3}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid="ai-image-prompt"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Pre-filled from your post content. You can edit it.
                </p>
              </div>

              <button
                type="button"
                onClick={() => void generateAiImages()}
                disabled={generating || !aiPrompt.trim()}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                data-testid="ai-generate-btn"
              >
                <Sparkles size={14} aria-hidden />
                {generating ? "Generating 4 variations…" : "Generate"}
              </button>

              {aiError && (
                <p className="text-xs text-destructive" role="alert" data-testid="ai-generate-error">
                  {aiError}
                </p>
              )}

              {/* Skeleton while generating */}
              {generating && (
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-lg bg-muted animate-pulse"
                      aria-hidden
                    />
                  ))}
                </div>
              )}

              {generated.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Select one to attach to your post
                  </p>
                  <div className="grid grid-cols-4 gap-2" data-testid="ai-generated-grid">
                    {generated.map((g) => {
                      const isSelected = selectedGenId === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setSelectedGenId(isSelected ? null : g.id)}
                          data-testid={`ai-generated-item-${g.id}`}
                          className={cn(
                            "relative aspect-square rounded-lg overflow-hidden border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            isSelected
                              ? "border-primary"
                              : "border-transparent hover:border-primary/40",
                          )}
                          aria-pressed={isSelected}
                          aria-label="Select generated image"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={g.url}
                            alt="AI generated"
                            className="w-full h-full object-cover"
                          />
                          {isSelected && (
                            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                              <div className="rounded-full bg-primary p-0.5">
                                <Check size={12} className="text-white" aria-hidden />
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          {tab === "library" && (
            <button
              type="button"
              onClick={handleUseLibrarySelection}
              disabled={selectedIds.size === 0}
              data-testid="media-library-use-selected"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Use selected ({selectedIds.size})
            </button>
          )}
          {tab === "ai" && generated.length > 0 && (
            <button
              type="button"
              onClick={handleUseAiSelection}
              disabled={!selectedGenId}
              data-testid="ai-use-selected"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Use selected
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
