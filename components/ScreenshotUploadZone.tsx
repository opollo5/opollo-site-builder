"use client";

import { useCallback, useId, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// ScreenshotUploadZone — Step-1 image upload affordance.
//
// Operator drops or selects up to 5 inspiration images. We hold the
// base64 + a preview URL in component state only — nothing is
// persisted to DB / Storage (parent plan: "Store uploaded images
// temporarily in component state only"). On each add we fire the
// onExtract callback so the parent can fold the vision-extracted
// design signals into the mood board.
//
// Accept: jpg / png / webp / gif. 5MB per file. Max 5 files.
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
type AcceptedType = (typeof ACCEPTED_TYPES)[number];

const MAX_FILES = 5;
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024;

export interface UploadedScreenshot {
  id: string;
  file_name: string;
  media_type: AcceptedType;
  base64: string; // no data: prefix
  preview_url: string; // object URL — parent must revokeObjectURL on unmount
  byte_size: number;
}

interface Props {
  screenshots: UploadedScreenshot[];
  onChange: (next: UploadedScreenshot[]) => void;
  busy: boolean;
  errorMessage?: string | null;
}

function isAcceptedType(t: string): t is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(t);
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // btoa wants a binary string; build one in 8K chunks to avoid
  // call-stack issues with large arrays.
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function ScreenshotUploadZone({
  screenshots,
  onChange,
  busy,
  errorMessage,
}: Props) {
  const inputId = useId();
  const dropZoneId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const remaining = MAX_FILES - screenshots.length;

  const ingest = useCallback(
    async (incoming: FileList | File[]) => {
      setLocalError(null);
      const list = Array.from(incoming);
      if (list.length === 0) return;
      if (screenshots.length + list.length > MAX_FILES) {
        setLocalError(
          `You can upload up to ${MAX_FILES} images. Remove one to add another.`,
        );
        return;
      }
      const accepted: UploadedScreenshot[] = [];
      for (const file of list) {
        if (!isAcceptedType(file.type)) {
          setLocalError(
            `${file.name}: only JPG, PNG, WebP, or GIF images are supported.`,
          );
          return;
        }
        if (file.size > MAX_BYTES_PER_FILE) {
          setLocalError(`${file.name}: file is over 5MB.`);
          return;
        }
        const base64 = await fileToBase64(file);
        accepted.push({
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          file_name: file.name,
          media_type: file.type,
          base64,
          preview_url: URL.createObjectURL(file),
          byte_size: file.size,
        });
      }
      onChange([...screenshots, ...accepted]);
    },
    [onChange, screenshots],
  );

  function onSelect(e: React.ChangeEvent<HTMLInputElement>): void {
    if (!e.target.files) return;
    void ingest(e.target.files);
    // Reset so the same filename can be re-selected after removal.
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    void ingest(e.dataTransfer.files);
  }

  function onRemove(id: string): void {
    const target = screenshots.find((s) => s.id === id);
    if (target) URL.revokeObjectURL(target.preview_url);
    onChange(screenshots.filter((s) => s.id !== id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (busy || remaining <= 0) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  const message = errorMessage ?? localError;

  return (
    <div
      className="space-y-3"
      data-testid="screenshot-upload"
      aria-busy={busy ? "true" : "false"}
    >
      <div className="flex items-end justify-between">
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium">
            Upload reference screenshots{" "}
            <span className="font-normal text-muted-foreground">
              (optional, up to {MAX_FILES})
            </span>
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag-and-drop or browse. JPG / PNG / WebP / GIF up to 5MB
            each. Used only to extract patterns — files aren&apos;t
            saved.
          </p>
        </div>
        {busy && (
          <span
            className="inline-flex items-center gap-1 text-sm text-muted-foreground"
            data-testid="screenshot-upload-busy"
            aria-live="polite"
          >
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            Reading your images…
          </span>
        )}
      </div>

      <div
        id={dropZoneId}
        role="button"
        tabIndex={busy || remaining <= 0 ? -1 : 0}
        aria-label={
          remaining > 0
            ? `Upload reference screenshots — ${remaining} of ${MAX_FILES} slot${remaining === 1 ? "" : "s"} remaining`
            : `Maximum ${MAX_FILES} screenshots reached`
        }
        aria-disabled={busy || remaining <= 0 ? "true" : "false"}
        aria-controls={inputId}
        onClick={() => {
          if (busy || remaining <= 0) return;
          inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && remaining > 0) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        className={[
          "flex flex-col items-center justify-center rounded-md border border-dashed bg-background px-4 py-6 text-center",
          "transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          dragOver
            ? "border-foreground bg-muted/30"
            : "border-muted-foreground/40 hover:border-foreground/60",
          busy || remaining <= 0
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer",
        ].join(" ")}
        data-testid="screenshot-upload-dropzone"
      >
        <ImagePlus
          aria-hidden
          className="h-6 w-6 text-muted-foreground"
        />
        <p className="mt-2 text-sm">
          {remaining > 0
            ? "Drop images here, or click to browse"
            : `${MAX_FILES} images uploaded — remove one to add another`}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {remaining > 0
            ? `${screenshots.length} of ${MAX_FILES} uploaded`
            : "Maximum reached"}
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          onChange={onSelect}
          disabled={busy || remaining <= 0}
          className="sr-only"
          data-testid="screenshot-upload-input"
        />
      </div>

      {message && (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-testid="screenshot-upload-error"
        >
          {message}
        </p>
      )}

      {screenshots.length > 0 && (
        <ul
          className="grid grid-cols-3 gap-2 md:grid-cols-5"
          data-testid="screenshot-upload-thumbnails"
          aria-label="Uploaded reference screenshots"
        >
          {screenshots.map((s) => (
            <li
              key={s.id}
              className="relative overflow-hidden rounded-md border bg-muted/20"
              data-testid="screenshot-upload-thumbnail"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.preview_url}
                alt={`Reference screenshot: ${s.file_name}`}
                className="block h-24 w-full object-cover"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute right-1 top-1 h-6 w-6"
                onClick={() => onRemove(s.id)}
                disabled={busy}
                aria-label={`Remove ${s.file_name}`}
                data-testid="screenshot-upload-remove"
              >
                <X aria-hidden className="h-3 w-3" />
              </Button>
              <p
                className="truncate px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={s.file_name}
              >
                {s.file_name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const SCREENSHOT_LIMITS = {
  maxFiles: MAX_FILES,
  maxBytesPerFile: MAX_BYTES_PER_FILE,
  acceptedTypes: ACCEPTED_TYPES,
} as const;
