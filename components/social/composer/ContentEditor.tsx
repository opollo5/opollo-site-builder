"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { logClientError } from "@/lib/errors/logClientError";
import { MediaTray } from "@/components/social/composer/MediaTray";
import { ToolsRow } from "@/components/social/composer/ToolsRow";
import { LinkPreviewCard, LinkPreviewLoader, type LinkPreviewData } from "@/components/social/composer/LinkPreviewCard";
import type { Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// ContentEditor — controlled textarea + char counter + media tray + tools row.
// Owns the file input so both MediaTray "+" and ToolsRow "Media" share
// the same upload flow.
// ---------------------------------------------------------------------------

export interface ContentEditorProps {
  value: string;
  onChange: (v: string) => void;
  mediaUrls: string[];
  onMediaChange: (urls: string[]) => void;
  maxLength: number;
  companyId: string;
  platforms?: Platform[];
  className?: string;
}

const MAX_FILES = 4;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = "image/jpeg,image/png,image/gif,image/webp";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function ContentEditor({
  value,
  onChange,
  mediaUrls,
  onMediaChange,
  maxLength,
  companyId,
  platforms,
  className,
}: ContentEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  // Tracks which indices in mediaUrls are GIFs (for MediaTile GIF badge).
  const [gifIndices, setGifIndices] = React.useState<Set<number>>(new Set());

  // Link preview state
  const [linkPreview, setLinkPreview] = React.useState<LinkPreviewData | null>(null);
  const [linkPreviewUrl, setLinkPreviewUrl] = React.useState<string | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = React.useState(false);
  const [linkPreviewDismissed, setLinkPreviewDismissed] = React.useState<string | null>(null);
  const linkDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const charCount = value.length;
  const isOverLimit = charCount > maxLength;
  const isNearLimit = !isOverLimit && charCount > maxLength * 0.9;

  // URL detection: debounce 250ms, fetch OG preview for the first URL found
  React.useEffect(() => {
    if (linkDebounceRef.current) clearTimeout(linkDebounceRef.current);

    const urlMatch = /https?:\/\/[^\s]+/i.exec(value);
    const detectedUrl = urlMatch?.[0] ?? null;

    if (!detectedUrl || detectedUrl === linkPreviewDismissed) {
      setLinkPreview(null);
      setLinkPreviewUrl(null);
      setLinkPreviewLoading(false);
      return;
    }

    if (detectedUrl === linkPreviewUrl) return;

    setLinkPreviewLoading(true);
    linkDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/platform/social/link-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_id: companyId, url: detectedUrl }),
          });
          const json = (await res.json()) as { ok: boolean; data?: LinkPreviewData };
          if (json.data) {
            setLinkPreview(json.data);
            setLinkPreviewUrl(detectedUrl);
          }
        } catch {
          // network failure — no preview shown
        } finally {
          setLinkPreviewLoading(false);
        }
      })();
    }, 250);

    return () => { if (linkDebounceRef.current) clearTimeout(linkDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, companyId, linkPreviewDismissed]);

  function insertText(text: string) {
    const el = textareaRef.current;
    if (!el) { onChange(value + text); return; }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    onChange(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = start + text.length;
      el.selectionEnd = start + text.length;
      el.focus();
    });
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList) {
    if (mediaUrls.length + files.length > MAX_FILES) {
      setUploadError(`Maximum ${MAX_FILES} images.`);
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
        void logClientError({ component: "media-upload", severity: "error", message: msg, traceId, companyId, context: { error_code: "MEDIA_UPLOAD_FAILED", http_status: res.status } });
        setUploading(false);
        return;
      }
      const json = (await res.json()) as { ok: boolean; data: { asset: { source_url: string } } };
      newUrls.push(json.data.asset.source_url);
    }
    onMediaChange([...mediaUrls, ...newUrls]);
    setUploading(false);
  }

  function attachGif(storageUrl: string) {
    if (mediaUrls.length >= MAX_FILES) {
      setUploadError(`Maximum ${MAX_FILES} media items.`);
      return;
    }
    const newIndex = mediaUrls.length;
    onMediaChange([...mediaUrls, storageUrl]);
    setGifIndices((prev) => new Set([...prev, newIndex]));
  }

  return (
    <div className={cn("rounded-xl border border-border bg-white overflow-hidden", className)}>
      <textarea
        ref={textareaRef}
        data-testid="content-textarea"
        value={value}
        onChange={(e) => { onChange(e.target.value); autoResize(); }}
        onInput={autoResize}
        placeholder="Write your post or generate one with AI"
        rows={4}
        className="block w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
        style={{ minHeight: "100px" }}
        aria-label="Post content"
      />

      {/* Link preview */}
      {linkPreviewLoading && (
        <div className="px-4 pb-3">
          <LinkPreviewLoader />
        </div>
      )}
      {!linkPreviewLoading && linkPreview && linkPreviewUrl && (
        <div className="px-4 pb-3">
          <LinkPreviewCard
            data={linkPreview}
            url={linkPreviewUrl}
            onDismiss={() => {
              setLinkPreviewDismissed(linkPreviewUrl);
              setLinkPreview(null);
              setLinkPreviewUrl(null);
            }}
          />
        </div>
      )}

      {/* Media thumbnails above the toolbar */}
      {(mediaUrls.length > 0 || uploading) && (
        <div className="px-4 pb-3">
          <MediaTray
            urls={mediaUrls}
            onRemove={(i) => {
              onMediaChange(mediaUrls.filter((_, idx) => idx !== i));
              setGifIndices((prev) => {
                const next = new Set<number>();
                prev.forEach((gi) => { if (gi < i) next.add(gi); else if (gi > i) next.add(gi - 1); });
                return next;
              });
            }}
            onRequestUpload={openPicker}
            gifIndices={gifIndices}
            uploading={uploading}
          />
        </div>
      )}

      <div className="border-t border-border px-4 py-3 space-y-3">
        {/* Char counter */}
        <div className="flex justify-end">
          <span
            className={cn(
              "text-xs tabular-nums",
              isOverLimit
                ? "text-destructive font-semibold"
                : isNearLimit
                ? "text-amber-600"
                : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {charCount} / {maxLength}
          </span>
        </div>

        {uploadError && (
          <p className="text-xs text-destructive" role="alert">{uploadError}</p>
        )}

        <ToolsRow
          companyId={companyId}
          onInsertText={insertText}
          onOpenMediaPicker={openPicker}
          onAttachGif={attachGif}
          platforms={platforms}
        />
      </div>

      {/* Shared file input for both MediaTray "+" and ToolsRow "Media" button */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="sr-only"
        data-testid="media-file-input"
        onChange={(e) => {
          if (e.target.files?.length) {
            void handleFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}
