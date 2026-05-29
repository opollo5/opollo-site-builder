"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// D3 — Ingestion UI.
//
// Accepts .xlsx or .docx upload (≤ 5 MB), shows a preview toggle, displays
// projected job count + cost from the API response, then dispatches the batch
// on "Generate". Links to the template downloads.
// ---------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ".xlsx,.docx";

type Mode = "generate" | "preview";

interface IngestResponse {
  ok: boolean;
  data?: {
    batchId: string;
    totalJobs: number;
    mode: string;
    parsedRows?: number;
  };
  error?: { message: string };
}

export function IngestClient({ companyId }: { companyId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("generate");
  const [submitting, setSubmitting] = useState(false);
  const [previewResult, setPreviewResult] = useState<IngestResponse["data"] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(f: File | null) {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds 5 MB limit.");
      return;
    }
    if (!f.name.endsWith(".xlsx") && !f.name.endsWith(".docx")) {
      toast.error("Only .xlsx and .docx files are accepted.");
      return;
    }
    setFile(f);
    setPreviewResult(null);
  }

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    setPreviewResult(null);

    const fd = new FormData();
    fd.append("company_id", companyId);
    fd.append("file", file);

    try {
      const res = await fetch(`/api/platform/image/ingest?mode=${mode}`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as IngestResponse;

      if (!json.ok) {
        toast.error(json.error?.message ?? "Ingest failed.");
        return;
      }

      if (mode === "preview") {
        setPreviewResult(json.data ?? null);
        toast.success("Preview complete. Check projected cost below.");
      } else {
        toast.success(`Batch started — ${json.data?.totalJobs ?? "?"} images queued.`);
        router.push(`/company/image/batches/${json.data?.batchId}`);
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* File drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0] ?? null); }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"} ${file ? "bg-muted/20" : ""}`}
      >
        {file ? (
          <div>
            <p className="font-medium text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024).toFixed(0)} KB — click to change</p>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium">Drop your file here or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">.xlsx or .docx · max 5 MB · up to 100 posts</p>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPTED} className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />

      {/* Template downloads */}
      <div className="text-xs text-muted-foreground">
        Need a template?{" "}
        <a href="/docs/briefs/image-generator/mass-image-gen-template.xlsx" download className="underline">Download .xlsx</a>
        {" · "}
        <a href="/docs/briefs/image-generator/mass-image-gen-template.docx" download className="underline">Download .docx</a>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Mode:</span>
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          {(["preview", "generate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setPreviewResult(null); }}
              className={`px-3 py-1.5 transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {m === "preview" ? "Preview (free)" : "Generate"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "preview" ? "Shows projected cost without calling Ideogram." : "Generates images and charges budget."}
        </p>
      </div>

      {/* Preview result */}
      {previewResult && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-1 text-sm">
          <p className="font-medium">Preview complete</p>
          <p className="text-muted-foreground">
            {previewResult.parsedRows ?? "?"} posts · {previewResult.totalJobs} image jobs projected ·
            estimated ${((previewResult.totalJobs ?? 0) * 0.06).toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">Switch to Generate mode and submit to create the images.</p>
        </div>
      )}

      {/* Submit */}
      <Button onClick={submit} disabled={!file || submitting} className="w-full">
        {submitting ? "Processing…" : mode === "preview" ? "Preview" : "Generate images"}
      </Button>
    </div>
  );
}
