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
  /** BL-7 publish lifecycle. */
  status: BulkCandidateStatus;
  /** Populated when status is `failed` or `saved`. */
  error?: string;
  postId?: string;
  editUrl?: string;
}

export type BulkCandidateStatus =
  | "pending"
  | "saving"
  | "saved"
  | "failed";

export function BulkUploadPanel({ siteId }: { siteId: string }) {
  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<BulkCandidate[]>([]);
  const [pastedCandidates, setPastedCandidates] = useState<BulkCandidate[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
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

  const summary = useMemo(() => summariseRun(allCandidates), [allCandidates]);

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

  // BL-8 — ⌘Enter triggers the publish run from anywhere in the bulk
  // panel. Skipped if the run is already going or there's nothing
  // to save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdEnter =
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key === "Enter";
      if (!isCmdEnter) return;
      const button = document.querySelector<HTMLButtonElement>(
        '[data-testid="bulk-publish-button"]',
      );
      if (!button || button.disabled) return;
      e.preventDefault();
      button.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // BL-7 — sequential publish orchestrator. Iterates accepted, non-
  // saved candidates and POSTs each to /api/sites/[siteId]/posts to
  // create a draft. Sequential so a failing card doesn't blow up the
  // queue; per-candidate status updates render in real time.
  const runPublish = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      // Snapshot the candidate list at run-start so newly-added
      // candidates during the run don't get pulled into the loop.
      const snapshot = allCandidates.filter(
        (c) => !c.rejected && c.status !== "saved",
      );
      for (const c of snapshot) {
        // Pre-flight validation — empty title or invalid slug -> mark
        // failed without hitting the API. The route would 400 anyway;
        // this just gives a clearer per-candidate error.
        const titleTrim = c.title.trim();
        if (titleTrim.length === 0) {
          updateCandidate(c.id, {
            status: "failed",
            error: "Title is empty.",
          });
          continue;
        }
        if (!/^[a-z0-9-]+$/.test(c.slug)) {
          updateCandidate(c.id, {
            status: "failed",
            error: "Slug must be lowercase letters, numbers, dashes only.",
          });
          continue;
        }
        updateCandidate(c.id, { status: "saving", error: undefined });
        try {
          const res = await fetch(`/api/sites/${siteId}/posts`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: titleTrim,
              slug: c.slug,
              metadata: parseBlogPostMetadata(c.source),
            }),
          });
          const payload = (await res.json().catch(() => null)) as
            | { ok: true; data: { id: string; edit_url: string } }
            | { ok: false; error: { code: string; message: string } }
            | null;
          if (payload?.ok) {
            updateCandidate(c.id, {
              status: "saved",
              postId: payload.data.id,
              editUrl: payload.data.edit_url,
            });
          } else {
            const msg =
              payload?.ok === false
                ? payload.error.message
                : `Save failed (HTTP ${res.status}).`;
            updateCandidate(c.id, { status: "failed", error: msg });
          }
        } catch (err) {
          updateCandidate(c.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      setRunning(false);
    }
  }, [allCandidates, siteId, running, updateCandidate]);

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
              {summary.headline}
            </p>
            <button
              type="button"
              onClick={clearAll}
              disabled={running}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-2">
            {allCandidates.map((c, idx) => (
              <BulkCandidateCard
                key={c.id}
                candidate={c}
                onChange={(patch) => updateCandidate(c.id, patch)}
                onRemove={
                  c.id.startsWith("file-")
                    ? () => removeFileCandidate(c.id)
                    : undefined
                }
                runDisabled={running}
                staggerIndex={idx}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {summary.detail && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="bulk-run-detail"
          >
            {summary.detail}
          </p>
        )}
        <span
          aria-hidden
          className="hidden items-center gap-0.5 text-xs text-muted-foreground sm:inline-flex"
        >
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            ⌘
          </kbd>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
            ↵
          </kbd>
        </span>
        <Button
          type="button"
          onClick={() => void runPublish()}
          disabled={running || acceptedCount === 0 || summary.runnable === 0}
          data-testid="bulk-publish-button"
        >
          {running
            ? `Saving ${summary.runningIndex}/${summary.runnable}…`
            : summary.runnable === 0 && summary.savedCount > 0
              ? "All saved"
              : `Save ${summary.runnable} draft${summary.runnable === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BL-7 — run-state summary derived from the candidate list. Centralises
// the four counts the UI needs (saved / runnable / failed / running)
// so the button label and the summary line stay in sync.
// ---------------------------------------------------------------------------

function summariseRun(candidates: BulkCandidate[]) {
  const accepted = candidates.filter((c) => !c.rejected);
  const rejectedCount = candidates.length - accepted.length;
  const savedCount = accepted.filter((c) => c.status === "saved").length;
  const failedCount = accepted.filter((c) => c.status === "failed").length;
  const savingIdx = accepted.findIndex((c) => c.status === "saving");
  // "Runnable" = accepted, not yet saved (failed counts; operator can retry).
  const runnable = accepted.filter((c) => c.status !== "saved").length;

  let headline = "";
  if (accepted.length === 0 && rejectedCount === 0) {
    headline = "0 posts ready";
  } else if (savedCount === 0 && failedCount === 0 && savingIdx === -1) {
    headline = `${accepted.length} ${accepted.length === 1 ? "post" : "posts"} ready`;
    if (rejectedCount > 0) headline += ` · ${rejectedCount} rejected`;
  } else {
    const parts: string[] = [];
    if (savedCount > 0) parts.push(`${savedCount} saved`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (runnable > savedCount + failedCount) {
      parts.push(`${runnable - failedCount} pending`);
    }
    if (rejectedCount > 0) parts.push(`${rejectedCount} rejected`);
    headline = parts.join(" · ") || `${accepted.length} posts ready`;
  }

  let detail: string | null = null;
  if (failedCount > 0 && !accepted.some((c) => c.status === "saving")) {
    detail = `${failedCount} failed — fix the highlighted cards and rerun.`;
  } else if (savedCount > 0 && runnable === 0) {
    detail = "All accepted drafts saved. Open each from its card to publish.";
  }

  return {
    headline,
    detail,
    savedCount,
    failedCount,
    runnable,
    runningIndex: savingIdx === -1 ? savedCount + failedCount + 1 : savingIdx + 1,
  };
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
    status: "pending",
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
  runDisabled,
  staggerIndex,
}: {
  candidate: BulkCandidate;
  onChange: (patch: Partial<BulkCandidate>) => void;
  onRemove?: () => void;
  runDisabled?: boolean;
  staggerIndex?: number;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const slugIsValid =
    candidate.slug.length === 0 || /^[a-z0-9-]+$/.test(candidate.slug);

  const bodyPreview = useMemo(
    () => extractBodyPreview(candidate.source),
    [candidate.source],
  );
  const bodyTruncated = bodyPreview.length > BODY_PREVIEW_CHARS;
  const inputsDisabled =
    candidate.rejected || candidate.status === "saving" || runDisabled === true;
  const savedReadOnly = candidate.status === "saved";

  // BL-9 — stagger-fade the first 6 cards as they appear, capped to
  // avoid a long sweep that delays the operator. Cards beyond the 6th
  // fall back to opollo-fade-in with no stagger.
  const staggerClass =
    staggerIndex !== undefined && staggerIndex > 0 && staggerIndex <= 6
      ? `opollo-stagger-in-${staggerIndex}`
      : "";

  return (
    <li
      className={cn(
        "opollo-fade-in rounded-md border bg-background transition-smooth",
        staggerClass,
        candidate.rejected && "opacity-50",
        candidate.status === "saved" && "border-success/40",
        candidate.status === "failed" && "border-destructive/40",
      )}
      data-testid="bulk-candidate-card"
      data-rejected={candidate.rejected ? "true" : "false"}
      data-status={candidate.status}
    >
      <div className="flex items-start gap-3 p-3">
        <FileText
          aria-hidden
          className={cn(
            "mt-2 h-4 w-4 shrink-0",
            candidate.status === "saved"
              ? "text-success"
              : candidate.status === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr]">
            <Input
              aria-label={`Title for ${candidate.origin}`}
              value={candidate.title}
              placeholder="Title"
              maxLength={200}
              disabled={inputsDisabled || savedReadOnly}
              onChange={(e) => onChange({ title: e.target.value })}
              data-testid="bulk-candidate-title"
              className="h-8 text-sm"
            />
            <Input
              aria-label={`Slug for ${candidate.origin}`}
              value={candidate.slug}
              placeholder="slug"
              maxLength={100}
              disabled={inputsDisabled || savedReadOnly}
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
          {candidate.status === "failed" && candidate.error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
              data-testid="bulk-candidate-error"
            >
              {candidate.error}
            </p>
          )}
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
          <CandidateStatusBadge candidate={candidate} />
          {!savedReadOnly && (
            <button
              type="button"
              onClick={() => onChange({ rejected: !candidate.rejected })}
              aria-pressed={candidate.rejected}
              disabled={runDisabled || candidate.status === "saving"}
              data-testid="bulk-candidate-reject"
              className={cn(
                "rounded border px-2 py-0.5 text-xs transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
                candidate.rejected
                  ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
                  : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {candidate.rejected ? "Restore" : "Reject"}
            </button>
          )}
          {onRemove && !savedReadOnly && (
            <button
              type="button"
              onClick={onRemove}
              disabled={runDisabled || candidate.status === "saving"}
              aria-label={`Remove ${candidate.origin}`}
              className="rounded-md p-1 text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function CandidateStatusBadge({ candidate }: { candidate: BulkCandidate }) {
  if (candidate.rejected) {
    return (
      <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Rejected
      </span>
    );
  }
  switch (candidate.status) {
    case "saving":
      return (
        <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/50" />
          Saving
        </span>
      );
    case "saved":
      return (
        <a
          href={candidate.editUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          // BL-9 — pop-in lands the saved state with a small bounce
          // so the operator's eye registers the success without
          // needing to read the badge.
          className="opollo-pop-in rounded border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-success transition-smooth hover:bg-success/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="bulk-candidate-saved-link"
        >
          Saved · open
        </a>
      );
    case "failed":
      return (
        <span className="rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-destructive">
          Failed
        </span>
      );
    default:
      return null;
  }
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
