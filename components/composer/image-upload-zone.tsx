"use client";

import { useCallback, useRef, useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import type { MediaRef } from "@/lib/platform/social/drafts";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — ImageUploadZone.
//
// Three-tab image picker per D12:
//   AI      — free-form prompt → POST /api/platform/social/cap/generate-image
//   Library — paginated grid from GET /api/platform/social/media
//   Upload  — drag-drop / file input → POST /api/platform/social/media/upload
//
// Single image per post in V1 (per §3 exclusions: no multi-image, no carousels).
// ---------------------------------------------------------------------------

type Tab = "ai" | "library" | "upload";

interface MediaAssetRow {
  id: string;
  source_url: string | null;
  mime_type: string;
  created_at: string;
}

interface ImageUploadZoneProps {
  companyId: string;
  mediaRef: MediaRef | null;
  onSelect: (ref: MediaRef | null) => void;
  disabled?: boolean;
}

export function ImageUploadZone({
  companyId,
  mediaRef,
  onSelect,
  disabled,
}: ImageUploadZoneProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("upload");

  // AI tab state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Library tab state
  const [libraryAssets, setLibraryAssets] = useState<MediaAssetRow[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  // Upload tab state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // -------------------------------------------------------------------------
  // AI generation
  // -------------------------------------------------------------------------

  const generateImage = useCallback(async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/platform/social/cap/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, prompt: aiPrompt.trim() }),
      });
      const result = await res.json();
      if (!result.ok) {
        setAiError(result.error?.message ?? "Image generation failed.");
        return;
      }
      const asset = result.data.asset as { id: string; source_url: string; width?: number; height?: number };
      onSelect({
        type: "ai_generated",
        url: asset.source_url,
        width: asset.width,
        height: asset.height,
        source_metadata: { asset_id: asset.id, prompt: aiPrompt },
      });
      setOpen(false);
    } catch {
      setAiError("Network error. Please try again.");
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiLoading, companyId, onSelect]);

  // -------------------------------------------------------------------------
  // Library loading
  // -------------------------------------------------------------------------

  const loadLibrary = useCallback(async () => {
    if (libraryLoaded || libraryLoading) return;
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const res = await fetch(
        `/api/platform/social/media?company_id=${encodeURIComponent(companyId)}&limit=24`,
      );
      const result = await res.json();
      if (!result.ok) {
        setLibraryError(result.error?.message ?? "Failed to load library.");
        return;
      }
      setLibraryAssets(result.data.assets as MediaAssetRow[]);
      setLibraryLoaded(true);
    } catch {
      setLibraryError("Network error loading library.");
    } finally {
      setLibraryLoading(false);
    }
  }, [companyId, libraryLoaded, libraryLoading]);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      if (tab === "library") void loadLibrary();
    },
    [loadLibrary],
  );

  // -------------------------------------------------------------------------
  // Direct upload
  // -------------------------------------------------------------------------

  const uploadFile = useCallback(
    async (file: File) => {
      const allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
      if (!allowed.includes(file.type)) {
        setUploadError("Only JPEG, PNG, GIF, and WebP images are supported.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setUploadError("File must be under 10 MB.");
        return;
      }
      setUploading(true);
      setUploadError(null);
      const fd = new FormData();
      fd.append("file", file);
      fd.append("company_id", companyId);
      try {
        const res = await fetch("/api/platform/social/media/upload", {
          method: "POST",
          body: fd,
        });
        const result = await res.json();
        if (!result.ok) {
          setUploadError(result.error?.message ?? "Upload failed.");
          return;
        }
        const asset = result.data.asset as { id: string; source_url: string; mime_type: string; bytes: number };
        onSelect({
          type: "upload",
          url: asset.source_url,
          cloudflare_id: asset.id,
          source_metadata: { asset_id: asset.id, mime_type: asset.mime_type, bytes: asset.bytes },
        });
        setOpen(false);
      } catch {
        setUploadError("Network error. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [companyId, onSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void uploadFile(file);
      e.target.value = "";
    },
    [uploadFile],
  );

  // -------------------------------------------------------------------------
  // Render: thumbnail or picker trigger
  // -------------------------------------------------------------------------

  if (mediaRef) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaRef.url}
          alt={mediaRef.alt_text ?? "Post image"}
          className="max-h-40 rounded-md border border-white/10 object-cover"
        />
        <button
          type="button"
          onClick={() => onSelect(null)}
          disabled={disabled}
          aria-label="Remove image"
          className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <NavIcon name="cross" size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Trigger */}
      {!open && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-white/20 py-6 text-sm text-muted-foreground hover:border-white/40 hover:text-foreground disabled:opacity-40"
        >
          <NavIcon name="picture" size={18} />
          Add an image
        </button>
      )}

      {/* Picker panel */}
      {open && (
        <div className="rounded-md border border-white/10 bg-white/[0.02]">
          {/* Tab bar */}
          <div className="flex border-b border-white/10">
            {(["upload", "library", "ai"] as Tab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => handleTabChange(tab)}
                className={[
                  "px-4 py-2 text-xs transition-colors",
                  activeTab === tab
                    ? "border-b-2 border-pk text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {tab === "upload" ? "Upload" : tab === "library" ? "Library" : "AI Generate"}
              </button>
            ))}
            <div className="ml-auto flex items-center px-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close image picker"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <NavIcon name="cross" size={14} />
              </button>
            </div>
          </div>

          {/* Upload tab */}
          {activeTab === "upload" && (
            <div className="p-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
                className={[
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:border-white/40 hover:text-foreground",
                  dragOver ? "border-pk bg-pk/5" : "border-white/20",
                  uploading ? "pointer-events-none opacity-60" : "",
                ].join(" ")}
              >
                {uploading ? (
                  <>
                    <NavIcon name="sync" size={24} className="animate-spin" />
                    <span>Uploading…</span>
                  </>
                ) : (
                  <>
                    <NavIcon name="upload" size={24} />
                    <span>Drag & drop or click to upload</span>
                    <span className="text-xs text-muted-foreground/60">JPEG, PNG, GIF, WebP · max 10 MB</span>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="sr-only"
                onChange={handleFileChange}
              />
              {uploadError && (
                <p className="mt-2 text-xs text-destructive">{uploadError}</p>
              )}
            </div>
          )}

          {/* Library tab */}
          {activeTab === "library" && (
            <div className="p-4">
              {libraryLoading && (
                <div className="flex items-center justify-center py-8">
                  <NavIcon name="sync" size={20} className="animate-spin text-muted-foreground" />
                </div>
              )}
              {libraryError && (
                <p className="text-xs text-destructive">{libraryError}</p>
              )}
              {!libraryLoading && libraryAssets.length === 0 && !libraryError && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No media in your library yet. Upload an image first.
                </p>
              )}
              {!libraryLoading && libraryAssets.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {libraryAssets.map((asset) =>
                    asset.source_url ? (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          onSelect({ type: "istock", url: asset.source_url!, source_metadata: { asset_id: asset.id } });
                          setOpen(false);
                        }}
                        className="group aspect-square overflow-hidden rounded border border-white/10 hover:border-pk"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={asset.source_url}
                          alt=""
                          className="h-full w-full object-cover opacity-80 group-hover:opacity-100"
                        />
                      </button>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          )}

          {/* AI Generate tab */}
          {activeTab === "ai" && (
            <div className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">
                Describe the image you want. Clear, specific prompts produce the best results.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. A professional team collaborating in a modern office"
                rows={3}
                className="w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20"
              />
              <button
                type="button"
                onClick={() => void generateImage()}
                disabled={!aiPrompt.trim() || aiLoading}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-pk px-4 py-2 text-sm font-medium text-white hover:bg-pk/80 disabled:opacity-50"
              >
                {aiLoading ? (
                  <>
                    <NavIcon name="sync" size={14} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  "Generate image"
                )}
              </button>
              {aiError && (
                <p className="text-xs text-destructive">{aiError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
