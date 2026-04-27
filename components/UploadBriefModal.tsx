"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// M12-1 — UploadBriefModal.
// UAT-smoke-1 — adds paste-text source mode + content_type radio group.
//
// Two source modes:
//   - file: existing file picker (.txt / .md, ≤ 10 MB).
//   - paste: textarea — operator pastes raw markdown directly. Routed
//            through the same parser path on the server (treated as
//            text/markdown).
//
// content_type: 'page' (default) | 'post'. Sent as a separate form
// field; server defaults to 'page' if absent or unrecognised.
// ---------------------------------------------------------------------------

const ERROR_TRANSLATIONS: Record<string, string> = {
  BRIEF_EMPTY: "Your brief is empty. Provide a non-empty file or paste content and try again.",
  BRIEF_TOO_LARGE:
    "That brief is too large. The 10 MB cap is there so the generator can keep the whole document in context.",
  BRIEF_UNSUPPORTED_TYPE:
    "Upload a plain-text (.txt) or Markdown (.md) file — or paste the brief instead.",
  IDEMPOTENCY_KEY_CONFLICT:
    "We've already stored a different brief with this idempotency key. Refresh and upload again without supplying a key.",
  VALIDATION_FAILED:
    "Some required fields are missing or invalid. Check the form and try again.",
  FORBIDDEN: "Your account doesn't have permission to upload briefs.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "This site no longer exists. Refresh the page and try again.",
};

type SourceMode = "file" | "paste";
type ContentType = "page" | "post";

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
  const [pasteText, setPasteText] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [contentType, setContentType] = useState<ContentType>("page");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setSelectedFileName(null);
    setPasteText("");
    setSourceMode("file");
    setContentType("page");
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

    if (sourceMode === "file") {
      const fileInput = fileInputRef.current;
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        setFormError("Pick a .txt or .md file to upload, or switch to Paste text.");
        return;
      }
    } else {
      if (pasteText.trim().length === 0) {
        setFormError("Paste the brief text into the textarea, or switch to Upload file.");
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const form = new FormData();
      form.append("site_id", siteId);
      form.append("content_type", contentType);

      let derivedDefaultTitle: string;
      if (sourceMode === "file") {
        const file = fileInputRef.current!.files![0]!;
        form.append("file", file);
        derivedDefaultTitle = file.name.replace(/\.[^.]+$/, "");
      } else {
        form.append("paste_text", pasteText);
        derivedDefaultTitle = "Pasted brief";
      }
      form.append(
        "title",
        title.trim().length > 0 ? title.trim() : derivedDefaultTitle,
      );

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
          A brief is a single document describing every page (or post) you
          want generated. We&apos;ll parse it into a list you can review
          before anything runs.
        </p>

        <div className="mt-4 space-y-4">
          {/* Content type — page vs post. */}
          <fieldset>
            <legend className="block text-sm font-medium">Content type</legend>
            <div className="mt-1 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="content_type"
                  value="page"
                  checked={contentType === "page"}
                  onChange={() => setContentType("page")}
                  disabled={submitting}
                />
                Page brief
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="content_type"
                  value="post"
                  checked={contentType === "post"}
                  onChange={() => setContentType("post")}
                  disabled={submitting}
                />
                Post brief
              </label>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Page briefs build site pages with anchor + revise cycles. Post
              briefs build blog posts (no anchor cycle).
            </p>
          </fieldset>

          {/* Source mode — file vs paste. */}
          <fieldset>
            <legend className="block text-sm font-medium">Source</legend>
            <div className="mt-1 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="source_mode"
                  value="file"
                  checked={sourceMode === "file"}
                  onChange={() => setSourceMode("file")}
                  disabled={submitting}
                />
                Upload file
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="source_mode"
                  value="paste"
                  checked={sourceMode === "paste"}
                  onChange={() => setSourceMode("paste")}
                  disabled={submitting}
                />
                Paste text
              </label>
            </div>
          </fieldset>

          {sourceMode === "file" ? (
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
          ) : (
            <div>
              <label htmlFor="brief-paste" className="block text-sm font-medium">
                Brief content
              </label>
              <textarea
                id="brief-paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                disabled={submitting}
                rows={12}
                className="mt-1 block w-full rounded-md border bg-background p-2 font-mono text-sm"
                placeholder={`# Site brief

## Page 1: Home
Description of the home page...

## Page 2: About
Description of the about page...`}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Paste markdown-shaped brief content. Use ## headings to
                separate pages. Max 10 MB of text.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="brief-title" className="block text-sm font-medium">
              Title (optional)
            </label>
            <Input
              id="brief-title"
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                sourceMode === "file"
                  ? "Defaults to the filename"
                  : "Defaults to 'Pasted brief'"
              }
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
