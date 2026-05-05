"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import type { PostMasterListItem } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// S7 — bulk CSV upload button for /company/social/posts.
//
// Hidden file input + visible trigger button. On file select the CSV is
// posted to /api/platform/social/posts/bulk as multipart/form-data.
// On success, onSuccess is called with the newly-created posts so the
// list can prepend them without a full page reload.
//
// Template CSV download generates a sample file client-side (no server
// round-trip needed).
// ---------------------------------------------------------------------------

interface BulkUploadResult {
  created: number;
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
  posts: PostMasterListItem[];
}

interface Props {
  companyId: string;
  onSuccess: (posts: PostMasterListItem[]) => void;
}

export function BulkUploadButton({ companyId, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function openPicker() {
    setResult(null);
    setUploadError(null);
    inputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-uploaded after fixing errors.
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setResult(null);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append("company_id", companyId);
      form.append("file", file);

      const res = await fetch("/api/platform/social/posts/bulk", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as
        | { ok: true; data: BulkUploadResult }
        | { ok: false; error: { message: string } };

      if (!json.ok) {
        setUploadError(json.error.message);
        return;
      }

      const data = json.data;
      setResult(data);

      if (data.created > 0) {
        toast.success(
          `${data.created} post${data.created !== 1 ? "s" : ""} imported.`,
        );
        onSuccess(data.posts);
      }
      if (data.errorCount > 0 && data.created === 0) {
        toast.error(`Upload failed — ${data.errorCount} row errors.`);
      } else if (data.errorCount > 0) {
        toast.warning(`Imported ${data.created} posts, ${data.errorCount} rows had errors.`);
      }
    } catch {
      setUploadError("Network error — please try again.");
    } finally {
      setUploading(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      "master_text,link_url",
      '"Your post copy goes here","https://example.com/article"',
      '"Another post with no link",',
      ',"https://example.com/link-only-post"',
    ].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "posts-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFile}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          data-testid="bulk-upload-button"
          className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          data-testid="bulk-template-download"
        >
          Download template
        </button>
      </div>

      {/* Upload error */}
      {uploadError ? (
        <div
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
          role="alert"
          data-testid="bulk-upload-error"
        >
          {uploadError}
        </div>
      ) : null}

      {/* Row-level errors after partial/full success */}
      {result && result.errorCount > 0 ? (
        <details
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm"
          data-testid="bulk-upload-row-errors"
        >
          <summary className="cursor-pointer font-medium text-amber-900">
            {result.errorCount} row{result.errorCount !== 1 ? "s" : ""} had errors
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {result.errors.map((err) => (
              <li key={err.row} className="text-amber-800">
                Row {err.row}: {err.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
