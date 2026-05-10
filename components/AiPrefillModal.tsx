"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CHAR_LIMIT = 20_000;

const ACCEPTED_EXTENSIONS = new Set([".docx", ".pdf", ".md", ".html", ".txt"]);
const ACCEPTED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "text/markdown",
  "text/html",
  "text/plain",
]);

// ---------------------------------------------------------------------------
// Types — kept local so this module has no server-only imports.
// ---------------------------------------------------------------------------

interface WpTaxonomyOptionLocal {
  id: number;
  name: string;
  slug: string;
  count: number;
  isNew?: boolean;
}

interface TaxonomyMatchRaw {
  name: string;
  isNew: boolean;
}

interface WpTaxonomyApiPayload {
  ok: true;
  data: { items: WpTaxonomyOptionLocal[] };
}

interface AiPrefillApiPayload {
  ok: true;
  data: {
    title: string | null;
    content: string;
    seo_title: string | null;
    meta_description: string | null;
    slug: string | null;
    categories: TaxonomyMatchRaw[];
    tags: TaxonomyMatchRaw[];
    excerpt: string | null;
    truncated: boolean;
  };
}

export interface AiPrefillApplyPayload {
  title: string | null;
  content: string;
  seo_title: string | null;
  meta_description: string | null;
  slug: string | null;
  categories: WpTaxonomyOptionLocal[];
  tags: WpTaxonomyOptionLocal[];
  excerpt: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExt(file: File): string {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function resolveToOption(
  match: TaxonomyMatchRaw,
  fetched: WpTaxonomyOptionLocal[],
): WpTaxonomyOptionLocal {
  if (!match.isNew) {
    const existing = fetched.find(
      (o) => o.name.toLowerCase() === match.name.toLowerCase(),
    );
    if (existing) return existing;
  }
  return {
    id: -Date.now() - Math.round(Math.random() * 1e6),
    name: match.name,
    slug: match.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, ""),
    count: 0,
    isNew: true,
  };
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface Props {
  siteId: string;
  open: boolean;
  onClose: () => void;
  onApply: (payload: AiPrefillApplyPayload) => void;
}

export function AiPrefillModal({ siteId, open, onClose, onApply }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const charCount = text.length;
  const isTruncated = charCount >= CHAR_LIMIT;
  const hasContent = text.trim().length > 0 || file !== null;

  function reset() {
    setText("");
    setFile(null);
    setError(null);
    setFileError(null);
    setIsDragOver(false);
  }

  function handleClose() {
    if (loading) return;
    abortRef.current?.abort();
    reset();
    onClose();
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val.length > CHAR_LIMIT ? val.slice(0, CHAR_LIMIT) : val);
    if (file) setFile(null);
    setFileError(null);
  }

  function validateAndSetFile(f: File) {
    setFileError(null);
    const ext = getExt(f);
    if (!ACCEPTED_EXTENSIONS.has(ext) && !ACCEPTED_MIME.has(f.type)) {
      setFileError("Unsupported file type. Accepted: .docx, .pdf, .md, .html, .txt");
      return;
    }
    setFile(f);
    setText("");
    setError(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) validateAndSetFile(dropped);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) validateAndSetFile(selected);
    e.target.value = "";
  }

  async function handleGenerate() {
    if (!hasContent || loading) return;
    setError(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const [catRes, tagRes] = await Promise.all([
        fetch(`/api/sites/${siteId}/wp-taxonomies?type=categories`, {
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch(`/api/sites/${siteId}/wp-taxonomies?type=tags`, {
          cache: "no-store",
          signal: controller.signal,
        }),
      ]);

      let fetchedCategories: WpTaxonomyOptionLocal[] = [];
      let fetchedTags: WpTaxonomyOptionLocal[] = [];

      try {
        const p = (await catRes.json()) as WpTaxonomyApiPayload | { ok: false };
        if (p.ok) fetchedCategories = (p as WpTaxonomyApiPayload).data.items;
      } catch { /* fail-soft */ }

      try {
        const p = (await tagRes.json()) as WpTaxonomyApiPayload | { ok: false };
        if (p.ok) fetchedTags = (p as WpTaxonomyApiPayload).data.items;
      } catch { /* fail-soft */ }

      const availableCategories = fetchedCategories.map((c) => c.name);
      const availableTags = fetchedTags.map((t) => t.name);

      const form = new FormData();
      if (file) {
        form.append("file", file);
      } else {
        form.append("text", text.slice(0, CHAR_LIMIT));
      }
      form.append("availableCategories", JSON.stringify(availableCategories));
      form.append("availableTags", JSON.stringify(availableTags));

      const resp = await fetch(`/api/sites/${siteId}/ai-prefill`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      const payload = (await resp.json()) as
        | AiPrefillApiPayload
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        setError(
          (payload as { ok: false; error: { message: string } }).error.message ??
            "Generation failed.",
        );
        return;
      }

      const { data } = payload as AiPrefillApiPayload;

      onApply({
        title: data.title,
        content: data.content,
        seo_title: data.seo_title,
        meta_description: data.meta_description,
        slug: data.slug,
        categories: data.categories.map((c) => resolveToOption(c, fetchedCategories)),
        tags: data.tags.map((t) => resolveToOption(t, fetchedTags)),
        excerpt: data.excerpt,
      });

      reset();
      onClose();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("Request timed out. Try with a shorter document.");
      } else {
        setError(
          err instanceof Error ? err.message : "Generation failed. Please retry.",
        );
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
      abortRef.current = null;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) handleClose();
      }}
    >
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(e) => {
          if (loading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (loading) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Generate from content</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Paste textarea */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Paste content
            </label>
            <Textarea
              value={text}
              onChange={handleTextChange}
              placeholder="Paste your blog draft here…"
              rows={8}
              disabled={loading || file !== null}
              className={cn(file !== null && "opacity-40")}
              aria-label="Blog content to extract metadata from"
              data-testid="ai-prefill-textarea"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span aria-live="polite" data-testid="ai-prefill-char-count">
                {charCount.toLocaleString()} / {CHAR_LIMIT.toLocaleString()}
              </span>
              {isTruncated && (
                <span className="text-warning" role="status">
                  Truncated to 20,000 characters
                </span>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase text-muted-foreground">
              <span className="bg-background px-2">or drop a file</span>
            </div>
          </div>

          {/* File dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-testid="ai-prefill-dropzone"
            className={cn(
              "rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
              isDragOver ? "border-primary bg-primary/5" : "border-border",
              loading && "pointer-events-none opacity-50",
            )}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <NavIcon name="paperclip" size={14} className="text-muted-foreground" />
                <span className="font-medium">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setFileError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Remove file"
                >
                  <NavIcon name="cross" size={14} />
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <NavIcon
                  name="upload"
                  size={24}
                  className="mx-auto mb-2 text-muted-foreground"
                />
                <p className="text-sm text-muted-foreground">
                  Drag and drop, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    choose a file
                  </button>
                </p>
                <p className="text-xs text-muted-foreground">
                  .docx · .pdf · .md · .html · .txt
                </p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.pdf,.md,.html,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/markdown,text/html,text/plain"
            className="sr-only"
            onChange={handleFileSelect}
            disabled={loading}
            data-testid="ai-prefill-file-input"
          />

          {fileError && (
            <p className="text-sm text-destructive" role="alert">
              {fileError}
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="ai-prefill-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={loading}
            data-testid="ai-prefill-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!hasContent || loading}
            data-testid="ai-prefill-generate"
          >
            {loading ? (
              <>
                <NavIcon name="sync" size={14} className="mr-2 animate-spin" />
                Analysing content…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
