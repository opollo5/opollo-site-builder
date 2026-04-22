"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// M12-1 — UploadBriefModal.
//
// Entry point for the brief-driven flow. Renders a file picker + title
// field, POSTs the multipart form to /api/briefs/upload, and on success
// navigates to the review page. Errors are translated to plain-English
// strings per docs/patterns/assistive-operator-flow.md.
// ---------------------------------------------------------------------------

const ERROR_TRANSLATIONS: Record<string, string> = {
  BRIEF_EMPTY: "Your brief is empty. Upload a file with content and try again.",
  BRIEF_TOO_LARGE:
    "That brief is too large. The 10 MB cap is there so the generator can keep the whole document in context.",
  BRIEF_UNSUPPORTED_TYPE:
    "Upload a plain-text (.txt) or Markdown (.md) file. Other formats aren't supported yet.",
  IDEMPOTENCY_KEY_CONFLICT:
    "We've already stored a different brief with this idempotency key. Refresh and upload again without supplying a key.",
  VALIDATION_FAILED:
    "Some required fields are missing or invalid. Check the file and try again.",
  FORBIDDEN: "Your account doesn't have permission to upload briefs.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "This site no longer exists. Refresh the page and try again.",
};

export function UploadBriefModal({
  open,
  siteId,
  onClose,
}: {
  open: boolean;
  siteId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSelectedFileName(null);
    setFormError(null);
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fileInput = fileInputRef.current;
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      setFormError("Pick a .txt or .md file to upload.");
      return;
    }
    const file = fileInput.files[0];

    setSubmitting(true);
    setFormError(null);

    try {
      const form = new FormData();
      form.append("site_id", siteId);
      form.append("title", title.trim().length > 0 ? title.trim() : file.name.replace(/\.[^.]+$/, ""));
      form.append("file", file);

      const res = await fetch("/api/briefs/upload", {
        method: "POST",
        body: form,
      });

      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { review_url: string; status: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (payload?.ok) {
        if (payload.data.status === "failed_parse") {
          // Still land on the review page — it surfaces the failure
          // details and the re-upload CTA.
          router.push(payload.data.review_url);
          onClose();
          return;
        }
        router.push(payload.data.review_url);
        onClose();
        return;
      }

      const code = payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback = payload?.ok === false ? payload.error.message : `Upload failed (HTTP ${res.status}).`;
      setFormError(ERROR_TRANSLATIONS[code] ?? fallback);
    } catch (err) {
      setFormError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-brief-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 id="upload-brief-title" className="text-lg font-semibold">
          Upload a brief
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A brief is a single document describing every page you want
          generated. We&apos;ll parse it into a page list you can review
          before anything runs.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="brief-file" className="block text-sm font-medium">
              File
            </label>
            <input
              id="brief-file"
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="mt-1 block w-full text-sm"
              disabled={submitting}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setSelectedFileName(f?.name ?? null);
              }}
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Plain text (.txt) or Markdown (.md). Max 10 MB.
            </p>
            {selectedFileName && (
              <p className="mt-1 text-xs text-foreground">
                Selected: <span className="font-medium">{selectedFileName}</span>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="brief-title" className="block text-sm font-medium">
              Title (optional)
            </label>
            <Input
              id="brief-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the filename"
              disabled={submitting}
              maxLength={200}
            />
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Uploading…" : "Upload and parse"}
          </Button>
        </div>
      </form>
    </div>
  );
}
