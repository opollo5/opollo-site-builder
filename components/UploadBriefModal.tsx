"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Composer, type ComposerValue } from "@/components/Composer";

// ---------------------------------------------------------------------------
// M12-1 — UploadBriefModal.
// RS-1 — drops the Source mode radio (Upload file / Paste text) for the
// unified Composer: one input area that accepts paste-text, drag-drop,
// and click-attach. content_type radio (page / post) stays — that's a
// real semantic choice, not a UX wart.
//
// Wire format unchanged: form-data with EITHER `paste_text` OR `file`
// based on the composer's resolved value. Server side is unchanged.
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ".txt,.md,text/plain,text/markdown";
const MAX_BRIEF_BYTES = 10 * 1024 * 1024;

const ERROR_TRANSLATIONS: Record<string, string> = {
  BRIEF_EMPTY:
    "Your brief is empty. Type or paste some content, or drop a file, and try again.",
  BRIEF_TOO_LARGE:
    "That brief is too large. The 10 MB cap is there so the generator can keep the whole document in context.",
  BRIEF_UNSUPPORTED_TYPE:
    "Drop or attach a plain-text (.txt) or Markdown (.md) file — or paste the brief instead.",
  IDEMPOTENCY_KEY_CONFLICT:
    "We've already stored a different brief with this idempotency key. Refresh and upload again without supplying a key.",
  VALIDATION_FAILED:
    "Some required fields are missing or invalid. Check the form and try again.",
  FORBIDDEN: "Your account doesn't have permission to upload briefs.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "This site no longer exists. Refresh the page and try again.",
};

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
  const [title, setTitle] = useState("");
  const [composerValue, setComposerValue] = useState<ComposerValue>({
    text: "",
    file: null,
  });
  const [contentType, setContentType] = useState<ContentType>("page");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setComposerValue({ text: "", file: null });
    setContentType("page");
    setFormError(null);
    setSubmitting(false);
  }, [open]);

  const hasContent =
    composerValue.file !== null || composerValue.text.trim().length > 0;

  function handleFileRejected(reason: "size" | "type", file: File) {
    if (reason === "size") {
      setFormError(
        `"${file.name}" is larger than the 10 MB cap. Trim it or split into a smaller brief.`,
      );
    } else {
      setFormError(
        `"${file.name}" isn't a .txt or .md file. Attach plain text or Markdown — or paste the brief instead.`,
      );
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!hasContent) {
      setFormError(
        "Type or paste some brief content, or attach a .txt / .md file.",
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const form = new FormData();
      form.append("site_id", siteId);
      form.append("content_type", contentType);

      // File wins when both are present — matches the legacy server
      // contract and avoids ambiguity.
      let derivedDefaultTitle: string;
      if (composerValue.file) {
        form.append("file", composerValue.file);
        derivedDefaultTitle = composerValue.file.name.replace(/\.[^.]+$/, "");
      } else {
        form.append("paste_text", composerValue.text);
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
        // Whether or not the parser succeeded, we land on the review
        // page — it surfaces the failure details and the re-upload CTA.
        // refresh() before push() invalidates the site-detail RSC tree
        // so a subsequent back-nav shows the new brief without a manual
        // page reload (the upload route's revalidatePath flushes the
        // server cache, but the client-side router cache also needs a
        // poke for bfcache / soft-nav consistency).
        router.refresh();
        router.push(payload.data.review_url);
        onClose();
        return;
      }

      const code = payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Upload failed (HTTP ${res.status}).`;
      setFormError(ERROR_TRANSLATIONS[code] ?? fallback);
    } catch (err) {
      setFormError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent
        // RS-1 acceptance: modal scrolls within viewport on 380px height.
        // Dialog default already enforces max-h-[calc(100dvh-2rem)] +
        // overflow-y-auto; no override needed.
        aria-labelledby="upload-brief-title"
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle id="upload-brief-title">Upload a brief</DialogTitle>
            <DialogDescription>
              A brief is a single document describing every page (or post) you
              want generated. Type, paste, or drop a .txt / .md file —
              we&apos;ll parse it into a list you can review before anything
              runs.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
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
              <p className="mt-1 text-sm text-muted-foreground">
                Page briefs build site pages with anchor + revise cycles. Post
                briefs build blog posts (no anchor cycle).
              </p>
            </fieldset>

            <div>
              <label htmlFor="brief-composer" className="block text-sm font-medium">
                Brief
              </label>
              <Composer
                textareaId="brief-composer"
                value={composerValue}
                onChange={setComposerValue}
                accept={ACCEPTED_TYPES}
                maxFileBytes={MAX_BRIEF_BYTES}
                disabled={submitting}
                onFileRejected={handleFileRejected}
                placeholder={`Type, paste, or drop a brief.\n\nExample:\n# Site brief\n\n## Page 1: Home\nDescription of the home page...`}
                acceptHint="Plain text (.txt) or Markdown (.md). Max 10 MB. Drag-drop, paste, or use + to attach."
                className="mt-1"
              />
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
                placeholder={
                  composerValue.file
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

          <DialogFooter className="mt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !hasContent}>
              {submitting ? "Uploading…" : "Upload and parse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
