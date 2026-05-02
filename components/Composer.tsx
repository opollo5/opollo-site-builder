"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import { Paperclip, X } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// RS-1 — Unified Composer.
//
// Claude.ai-style single-input composer: one resizing textarea that
// also accepts file attachments via paste (clipboard files), drag-drop
// onto the wrapper, or the "+" button → native file picker.
//
// Replaces the radio-toggle pattern (Upload file / Paste text) in
// UploadBriefModal. Shared with the BP-3 blog-post entry point so a
// single mental model covers both flows.
//
// Wire format remains form-data with EITHER `paste_text` OR `file` set
// — the calling form picks one based on `value.file`. Server side is
// unchanged.
// ---------------------------------------------------------------------------

export interface ComposerValue {
  text: string;
  file: File | null;
}

export interface ComposerProps {
  value: ComposerValue;
  onChange: (next: ComposerValue) => void;
  /** Comma-separated MIME types and/or extensions (e.g. ".md,.txt,text/markdown"). */
  accept: string;
  /** Human-friendly description shown beneath the input (e.g. "Plain text or Markdown — max 10 MB."). */
  acceptHint?: ReactNode;
  /** Max bytes a dropped/pasted file may be. Files exceeding the cap surface `onFileRejected`. */
  maxFileBytes?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Surfaces drop / paste failures (size, type) so the host form can render a localised error. */
  onFileRejected?: (reason: "size" | "type", file: File) => void;
  /** Min rows for the auto-grow textarea. Default 3. */
  minRows?: number;
  /** Max pixel height for the auto-grow textarea. Default 288 (≈ 12 lines). */
  maxHeightPx?: number;
  /** Optional id for the underlying textarea (label association). */
  textareaId?: string;
  className?: string;
}

function fileMatchesAccept(file: File, accept: string): boolean {
  if (!accept) return true;
  const items = accept.split(",").map((s) => s.trim()).filter(Boolean);
  const lowerName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();
  for (const item of items) {
    const lowerItem = item.toLowerCase();
    if (lowerItem.startsWith(".")) {
      if (lowerName.endsWith(lowerItem)) return true;
    } else if (lowerItem.endsWith("/*")) {
      if (fileType.startsWith(lowerItem.slice(0, -1))) return true;
    } else if (fileType === lowerItem) {
      return true;
    }
  }
  return false;
}

export function Composer({
  value,
  onChange,
  accept,
  acceptHint,
  maxFileBytes,
  placeholder,
  disabled,
  onFileRejected,
  minRows = 3,
  maxHeightPx = 288,
  textareaId,
  className,
}: ComposerProps) {
  const reactId = useId();
  const inputId = textareaId ?? `composer-${reactId}`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Auto-grow the textarea up to maxHeightPx, then scroll inside.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
  }, [value.text, maxHeightPx]);

  const acceptFile = useCallback(
    (file: File): boolean => {
      if (!fileMatchesAccept(file, accept)) {
        onFileRejected?.("type", file);
        return false;
      }
      if (maxFileBytes !== undefined && file.size > maxFileBytes) {
        onFileRejected?.("size", file);
        return false;
      }
      onChange({ text: value.text, file });
      return true;
    },
    [accept, maxFileBytes, onChange, onFileRejected, value.text],
  );

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    const candidate = files[0];
    if (!candidate) return;
    e.preventDefault();
    acceptFile(candidate);
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      setDragActive(true);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    const candidate = files[0];
    if (!candidate) return;
    acceptFile(candidate);
  }

  function clearFile() {
    if (disabled) return;
    onChange({ text: value.text, file: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Reset native file input when the controlled file is cleared externally.
  useEffect(() => {
    if (value.file === null && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [value.file]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-background transition-smooth",
        dragActive && "border-ring ring-2 ring-ring/40",
        disabled && "opacity-60",
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-drag-active={dragActive ? "true" : undefined}
    >
      {value.file && (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span
            className="inline-flex h-11 max-w-full items-center gap-2 rounded-md bg-muted px-3 text-sm"
            data-testid="composer-attached-file"
          >
            <span aria-hidden className="text-base leading-none">📎</span>
            <span className="truncate font-medium">{value.file.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground">
              {Math.round(value.file.size / 1024).toLocaleString()} KB
            </span>
            <button
              type="button"
              onClick={clearFile}
              disabled={disabled}
              aria-label={`Remove ${value.file.name}`}
              className={cn(
                "ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground hover:bg-background hover:text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:pointer-events-none",
              )}
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}

      <div className="flex items-end gap-2 p-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file"
          title="Attach a file"
          className={cn(
            "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-smooth disabled:pointer-events-none",
          )}
        >
          <Paperclip aria-hidden className="h-5 w-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f) acceptFile(f);
          }}
          disabled={disabled}
        />
        <textarea
          id={inputId}
          ref={textareaRef}
          value={value.text}
          rows={minRows}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange({ text: e.target.value, file: value.file })}
          onPaste={handlePaste}
          className={cn(
            "block w-full resize-none rounded-md bg-background px-2 py-2",
            "text-sm leading-6 outline-none",
            "placeholder:text-muted-foreground",
            "disabled:cursor-not-allowed",
          )}
          style={{ maxHeight: maxHeightPx }}
        />
      </div>

      {acceptHint && (
        <p className="px-3 pb-2 text-sm text-muted-foreground">{acceptHint}</p>
      )}
    </div>
  );
}
