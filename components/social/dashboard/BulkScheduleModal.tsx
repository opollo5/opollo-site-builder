"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { parseCsv, type ParseResult, type ParsedRow, type ValidationError } from "@/lib/social/bulk-csv/parse";

// ---------------------------------------------------------------------------
// BulkScheduleModal — COMPONENT_MAP.md §"Bulk CSV modal" (PR G)
//
// Three states: empty-state → preview (with errors) → success
// All-or-nothing: submission blocked until zero errors.
// Rate-limit state: 429 → error banner with retry-after hint.
// ---------------------------------------------------------------------------

export interface BulkScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (batchId: string, count: number) => void;
}

const EXAMPLE_CSV = `Content,Date,Time,Channel
"Tips for running a secure MSP in 2026.",05/21/2026,09:00,LinkedIn
"Visit us this Saturday — autumn hours start now.",05/21/2026,14:00,LinkedIn|Facebook
"Exciting announcement coming soon. Stay tuned!",05/22/2026,10:00,(all)
`;

type ModalState = "empty" | "preview" | "submitting" | "success";

interface FileInfo {
  name: string;
  sizeKb: number;
}

function rowHasError(rowIndex: number, errors: ValidationError[]): boolean {
  return errors.some((e) => e.row === rowIndex);
}

function errorForCell(rowIndex: number, col: ValidationError["column"], errors: ValidationError[]): string | null {
  return errors.find((e) => e.row === rowIndex && e.column === col)?.message ?? null;
}

export function BulkScheduleModal({ open, onClose, onSuccess }: BulkScheduleModalProps) {
  const [state, setModalState] = React.useState<ModalState>("empty");
  const [fileInfo, setFileInfo] = React.useState<FileInfo | null>(null);
  const [parseResult, setParseResult] = React.useState<ParseResult | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function handleClose() {
    setModalState("empty");
    setFileInfo(null);
    setParseResult(null);
    setIsDragOver(false);
    setSubmitError(null);
    onClose();
  }

  function processFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseCsv(text);
      setParseResult(result);
      setFileInfo({ name: file.name, sizeKb: Math.round(file.size / 1024) });
      setModalState("preview");
    };
    reader.readAsText(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleDownloadExample() {
    const blob = new Blob([EXAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "opollo-bulk-example.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit() {
    if (!parseResult || parseResult.errors.length > 0) return;
    setModalState("submitting");
    setSubmitError(null);

    try {
      const res = await fetch("/api/platform/social/drafts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parseResult.rows }),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const mins = retryAfter ? Math.ceil(Number(retryAfter) / 60) : "a few";
        setSubmitError(
          `You've reached the upload limit for this hour. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
        );
        setModalState("preview");
        return;
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
      }

      const data = (await res.json()) as { data?: { batch_id?: string; created?: number } };
      const batchId = data?.data?.batch_id ?? "";
      const count = data?.data?.created ?? parseResult.rows.length;
      setModalState("success");
      onSuccess(batchId, count);
      setTimeout(handleClose, 1500);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setModalState("preview");
    }
  }

  const hasErrors = (parseResult?.errors.length ?? 0) > 0;
  const globalErrors = parseResult?.errors.filter((e) => e.row === 0) ?? [];
  const rowErrors = parseResult?.errors.filter((e) => e.row > 0) ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl" data-testid="bulk-schedule-modal">
        <DialogHeader>
          <DialogTitle>Bulk scheduling</DialogTitle>
        </DialogHeader>

        {(state === "empty" || state === "success") && (
          <div
            className={cn(
              "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-12 text-center transition-colors",
              isDragOver && "border-primary bg-primary/5",
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            data-testid="bulk-drop-zone"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="3" x2="9" y2="21" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Import from a CSV file</h3>
              <p className="mt-1 text-xs text-muted-foreground">Up to 100 posts from one table.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                data-testid="upload-csv-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Upload CSV
              </button>
              <button
                type="button"
                onClick={handleDownloadExample}
                className="flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
                data-testid="download-example-btn"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download example
              </button>
            </div>
            <p className="text-xs text-muted-foreground">You can drag &amp; drop your file here</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="sr-only"
              data-testid="file-input"
            />
          </div>
        )}

        {(state === "preview" || state === "submitting") && parseResult && (
          <div className="flex flex-col gap-4">
            {/* File info bar */}
            <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5" data-testid="file-info-bar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{fileInfo?.name}</div>
                <div className="text-xs text-muted-foreground">
                  {fileInfo?.sizeKb} KB · {parseResult.rows.length + parseResult.errors.filter(e => e.row > 0).length} rows
                  {rowErrors.length > 0 && ` · ${rowErrors.length} error${rowErrors.length === 1 ? "" : "s"}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalState("empty");
                  setParseResult(null);
                  setFileInfo(null);
                  setSubmitError(null);
                }}
                className="text-xs text-muted-foreground border border-border rounded px-2 py-1 hover:bg-background transition-colors"
              >
                Replace
              </button>
            </div>

            {/* Preview table */}
            <div className="overflow-auto rounded-md border border-border max-h-64" data-testid="preview-table">
              <table className="w-full border-collapse text-xs">
                <thead className="bg-muted">
                  <tr>
                    {["#", "Content", "Date", "Time", "Channel"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.rows.map((row: ParsedRow) => {
                    const hasErr = rowHasError(row.rowIndex, parseResult.errors);
                    return (
                      <tr
                        key={row.rowIndex}
                        className={cn("border-t border-border", hasErr && "bg-destructive/10")}
                        data-testid={hasErr ? "error-row" : "valid-row"}
                      >
                        <td className={cn("px-3 py-2", hasErr && "text-destructive")}>{row.rowIndex}</td>
                        <td className={cn("px-3 py-2 max-w-xs truncate", hasErr && "text-destructive")} title={row.content}>{row.content}</td>
                        <td className={cn("px-3 py-2", errorForCell(row.rowIndex, "Date", parseResult.errors) && "text-destructive")}>{row.date}</td>
                        <td className={cn("px-3 py-2", errorForCell(row.rowIndex, "Time", parseResult.errors) && "text-destructive")}>{row.time}</td>
                        <td className={cn("px-3 py-2", errorForCell(row.rowIndex, "Channel", parseResult.errors) && "text-destructive")}>{row.channels.join(", ") || "(all)"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Error banners */}
            {globalErrors.length > 0 && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="global-error-banner">
                {globalErrors.map((e, i) => <p key={i}>{e.message}</p>)}
              </div>
            )}

            {rowErrors.length > 0 && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="row-error-banner">
                {rowErrors.length} error{rowErrors.length === 1 ? "" : "s"} found. Fix them in your CSV and re-upload — partial imports are not supported.
              </div>
            )}

            {submitError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="submit-error-banner">
                {submitError}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          {(state === "preview" || state === "submitting") && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={hasErrors || state === "submitting"}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:pointer-events-none disabled:opacity-50"
              data-testid="schedule-all-btn"
            >
              {state === "submitting"
                ? "Scheduling…"
                : hasErrors
                ? `Schedule all (fix errors first)`
                : `Schedule all (${parseResult?.rows.length ?? 0})`}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
