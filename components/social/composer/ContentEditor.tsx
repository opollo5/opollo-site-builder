"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MediaTray } from "@/components/social/composer/MediaTray";
import { ToolsRow } from "@/components/social/composer/ToolsRow";

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
  className,
}: ContentEditorProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const charCount = value.length;
  const isOverLimit = charCount > maxLength;
  const isNearLimit = !isOverLimit && charCount > maxLength * 0.9;

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
        setUploadError((json.error?.message ?? "Upload failed.") + ` [trace: ${traceId}]`);
        setUploading(false);
        return;
      }
      const json = (await res.json()) as { ok: boolean; data: { asset: { source_url: string } } };
      newUrls.push(json.data.asset.source_url);
    }
    onMediaChange([...mediaUrls, ...newUrls]);
    setUploading(false);
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

      {/* Media thumbnails above the toolbar */}
      {(mediaUrls.length > 0 || uploading) && (
        <div className="px-4 pb-3">
          <MediaTray
            urls={mediaUrls}
            onRemove={(i) => onMediaChange(mediaUrls.filter((_, idx) => idx !== i))}
            onRequestUpload={openPicker}
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
        />
      </div>

      {/* Shared file input for both MediaTray "+" and ToolsRow "Media" button */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="sr-only"
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
