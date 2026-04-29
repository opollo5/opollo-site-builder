"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight, FileText, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  parseBlogPostMetadata,
  slugify,
} from "@/lib/blog-post-parser";
import {
  splitBulkPaste,
  type SplitDocument,
} from "@/lib/bulk-post-splitter";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// BL-5 — Bulk upload input surface.
//
// Two ways in:
//   1. Drop multiple `.md` / `.html` / `.txt` files. Each file is one
//      post candidate.
//   2. Paste a single multi-document blob. Two recognised shapes:
//        a. `\n\n---\n\n` between bodies (mode-1).
//        b. Stacked YAML front-matter — `---\nkey: v\n---\nbody` blocks
//           one after another (mode-2).
//
// BL-5 ships the inputs, the de-duplication, and a basic candidate
// list. BL-6 will swap the candidate list for rich preview cards with
// inline edit/reject. BL-7 will plumb the publish orchestrator.
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB per file
const ACCEPT_EXTENSIONS = [".md", ".html", ".txt"];
const ACCEPT_MIME = ["text/markdown", "text/html", "text/plain"];

export interface BulkCandidate {
  id: string;
  source: string;
  /** Display name — file name for drops, "Pasted post #N" otherwise. */
  origin: string;
  /** Operator-editable title. Defaults to the parser's detected title. */
  title: string;
  /** Operator-editable slug. Defaults to the parser's detected slug. */
  slug: string;
  detectedTitle: string | null;
  detectedSlug: string | null;
  wordCount: number;
  /** Operator can flag a candidate to skip publishing. */
  rejected: boolean;
}

export function BulkUploadPanel({ siteId }: { siteId: string }) {
  // siteId reserved — BL-7's publish orchestrator will scope draft
  // creation to the chosen site. BL-5 doesn't yet hit the API.
  void siteId;

  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<BulkCandidate[]>([]);
  const [pastedCandidates, setPastedCandidates] = useState<BulkCandidate[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // BL-6 — pasted candidates rebuild from `pasted` whenever the
  // operator changes the paste textarea. Per-card edits live on the
  // pastedCandidates state and don't trigger this effect.
  useEffect(() => {
    const docs = splitBulkPaste(pasted);
    setPastedCandidates(
      docs.map((d) =>
        candidateFromSource(d.source, `Pasted post #${d.index + 1}`),
      ),
    );
  }, [pasted]);

  const allCandidates = useMemo<BulkCandidate[]>(() => {
    return [...files, ...pastedCandidates];
  }, [files, pastedCandidates]);

  const acceptedCount = useMemo(
    () => allCandidates.filter((c) => !c.rejected).length,
    [allCandidates],
  );

  const updateCandidate = useCallback(
    (id: string, patch: Partial<BulkCandidate>) => {
      setFiles((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
      setPastedCandidates((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      );
    },
    [],
  );

  const onFilesChosen = useCallback(async (chosen: FileList | File[]) => {
    setError(null);
    const arr = Array.from(chosen);
    const errors: string[] = [];
    const next: BulkCandidate[] = [];
    for (const file of arr) {
      if (file.size > MAX_FILE_BYTES) {
        errors.push(`${file.name}: exceeds 10 MB cap.`);
        continue;
      }
      if (!isAcceptedFile(file)) {
        errors.push(`${file.name}: unsupported type. Use .md / .html / .txt.`);
        continue;
      }
      try {
        const text = await file.text();
        next.push(candidateFromSource(text, file.name));
      } catch (e) {
        errors.push(
          `${file.name}: ${e instanceof Error ? e.message : "could not read file"}.`,
        );
      }
    }
    if (next.length > 0) {
      setFiles((prev) => [...prev, ...next]);
    }
    if (errors.length > 0) {
      setError(errors.join("\n"));
    }
  }, []);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void onFilesChosen(e.dataTransfer.files);
    }
  }

  function removeFileCandidate(id: string) {
    setFiles((prev) => prev.filter((c) => c.id !== id));
  }

  function clearAll() {
    setFiles([]);
    setPasted("");
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-md border border-dashed p-8 text-center text-sm transition-smooth",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-input bg-muted/20 hover:bg-muted/30",
        )}
        data-testid="bulk-dropzone"
      >
        <Upload aria-hidden className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Drop markdown, HTML, or text files here</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Each file becomes one post. Max 10 MB per file. Or
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ml-1 font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            choose files
          </button>
          .
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[...ACCEPT_EXTENSIONS, ...ACCEPT_MIME].join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              void onFilesChosen(e.target.files);
              // Reset the input so re-uploading the same file fires the change event.
              e.target.value = "";
            }
          }}
          data-testid="bulk-file-input"
        />
      </div>

      <div>
        <label
          htmlFor="bulk-paste"
          className="block text-sm font-medium"
        >
          Or paste multiple posts
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Separate documents with a <code className="font-mono">---</code>
          {" "}line on its own (between blank lines), or stack YAML front-
          matter blocks back-to-back.
        </p>
        <Textarea
          id="bulk-paste"
          className="mt-2 font-mono text-xs"
          rows={10}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={`---
title: First post
---
Body of first post.

---

---
title: Second post
---
Body of second post.`}
          data-testid="bulk-paste-textarea"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {allCandidates.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" data-testid="bulk-summary">
              {acceptedCount} {acceptedCount === 1 ? "post" : "posts"} ready
              {allCandidates.length !== acceptedCount &&
                ` · ${allCandidates.length - acceptedCount} rejected`}
            </p>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-2">
            {allCandidates.map((c) => (
              <BulkCandidateCard
                key={c.id}
                candidate={c}
                onChange={(patch) => updateCandidate(c.id, patch)}
                onRemove={
                  c.id.startsWith("file-")
                    ? () => removeFileCandidate(c.id)
                    : undefined
                }
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            BL-7 will plumb the publish orchestrator into the Continue button.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" disabled title="Wired in BL-7.">
          Continue to publish
        </Button>
      </div>
    </div>
  );
}

function isAcceptedFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  if (ACCEPT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  if (file.type && ACCEPT_MIME.includes(file.type)) return true;
  return false;
}

let candidateCounter = 0;

function candidateFromSource(source: string, origin: string): BulkCandidate {
  const parsed = parseBlogPostMetadata(source);
  candidateCounter += 1;
  return {
    id: `${origin.startsWith("Pasted") ? "paste" : "file"}-${candidateCounter}`,
    source,
    origin,
    title: parsed.title ?? "",
    slug: parsed.slug ?? "",
    detectedTitle: parsed.title,
    detectedSlug: parsed.slug,
    wordCount: countWords(source),
    rejected: false,
  };
}

// ---------------------------------------------------------------------------
// BL-6 — Per-candidate editable preview card.
//
// Replaces the BL-5 row layout. Title + slug are inline-editable;
// rejected toggle dims the card and decrements the "ready" count;
// preview disclosure shows the first ~600 chars of the parsed body.
// ---------------------------------------------------------------------------

const BODY_PREVIEW_CHARS = 600;

function BulkCandidateCard({
  candidate,
  onChange,
  onRemove,
}: {
  candidate: BulkCandidate;
  onChange: (patch: Partial<BulkCandidate>) => void;
  onRemove?: () => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const slugIsValid =
    candidate.slug.length === 0 || /^[a-z0-9-]+$/.test(candidate.slug);

  const bodyPreview = useMemo(
    () => extractBodyPreview(candidate.source),
    [candidate.source],
  );
  const bodyTruncated = bodyPreview.length > BODY_PREVIEW_CHARS;

  return (
    <li
      className={cn(
        "rounded-md border bg-background transition-smooth",
        candidate.rejected && "opacity-50",
      )}
      data-testid="bulk-candidate-card"
      data-rejected={candidate.rejected ? "true" : "false"}
    >
      <div className="flex items-start gap-3 p-3">
        <FileText
          aria-hidden
          className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr]">
            <Input
              aria-label={`Title for ${candidate.origin}`}
              value={candidate.title}
              placeholder="Title"
              maxLength={200}
              disabled={candidate.rejected}
              onChange={(e) => onChange({ title: e.target.value })}
              data-testid="bulk-candidate-title"
              className="h-8 text-sm"
            />
            <Input
              aria-label={`Slug for ${candidate.origin}`}
              value={candidate.slug}
              placeholder="slug"
              maxLength={100}
              disabled={candidate.rejected}
              onChange={(e) =>
                onChange({ slug: e.target.value.toLowerCase() })
              }
              onBlur={() => {
                if (candidate.slug && !slugIsValid) {
                  onChange({ slug: slugify(candidate.slug) });
                }
              }}
              aria-invalid={!slugIsValid}
              data-testid="bulk-candidate-slug"
              className="h-8 font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {candidate.origin} · {candidate.wordCount.toLocaleString()} words
            {!slugIsValid && (
              <span className="ml-2 text-destructive">
                Slug needs lowercase letters, numbers, dashes only.
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            aria-expanded={previewOpen}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            data-testid="bulk-candidate-preview-toggle"
          >
            {previewOpen ? (
              <ChevronDown aria-hidden className="h-3 w-3" />
            ) : (
              <ChevronRight aria-hidden className="h-3 w-3" />
            )}
            Preview body
          </button>
          {previewOpen && (
            <div
              className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap"
              data-testid="bulk-candidate-preview"
            >
              {bodyPreview.slice(0, BODY_PREVIEW_CHARS)}
              {bodyTruncated && (
                <span className="text-muted-foreground/70">
                  {" "}…
                  <span className="ml-1 italic">
                    ({bodyPreview.length - BODY_PREVIEW_CHARS} more chars)
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onChange({ rejected: !candidate.rejected })}
            aria-pressed={candidate.rejected}
            data-testid="bulk-candidate-reject"
            className={cn(
              "rounded border px-2 py-0.5 text-xs transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              candidate.rejected
                ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {candidate.rejected ? "Restore" : "Reject"}
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${candidate.origin}`}
              className="rounded-md p-1 text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function extractBodyPreview(source: string): string {
  // Strip leading YAML front-matter, then collapse whitespace runs.
  const stripped = source.replace(/^---[\s\S]*?\n---\n/, "").trim();
  return stripped.replace(/\n{3,}/g, "\n\n");
}

function countWords(text: string): number {
  if (!text) return 0;
  const stripped = text
    .replace(/^---[\s\S]*?---/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/[#*_>~`-]+/g, " ");
  return stripped.split(/\s+/).filter((t) => t.length > 0).length;
}

export { type SplitDocument };
