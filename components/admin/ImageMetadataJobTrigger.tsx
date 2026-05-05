"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Progress = {
  total: number;
  done: number;
  remaining: number;
  pct: number;
  cfCredsPresent: boolean;
};

type BatchResult = {
  processed: number;
  saved: number;
  noData: number;
  errors: number;
  remaining: number | null;
  done: boolean;
};

const POLL_MS = 4000;

export function ImageMetadataJobTrigger() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/jobs/extract-image-metadata");
      if (!res.ok) return;
      const data = (await res.json()) as Progress;
      setProgress(data);
    } catch {
      // silent — polling is best-effort
    }
  }, []);

  useEffect(() => {
    void fetchProgress();
    function schedule() {
      timerRef.current = setTimeout(async () => {
        await fetchProgress();
        // Stop polling when everything is done.
        if (progress?.remaining !== 0) schedule();
      }, POLL_MS);
    }
    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchProgress, progress?.remaining]);

  async function runBatch() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/jobs/extract-image-metadata", {
        method: "POST",
      });
      const data = (await res.json()) as BatchResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Batch failed");
      } else {
        setLastResult(data);
        await fetchProgress();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  const isDone = progress?.remaining === 0;
  const noCredsMsg =
    progress && !progress.cfCredsPresent
      ? "Cloudflare credentials are not set on this deployment."
      : null;

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Image metadata extraction</p>
          <p className="text-xs text-muted-foreground">
            Fetches original CF blobs and writes dimensions, dominant colour, and
            EXIF to <code>image_library</code> + <code>image_metadata</code>.
            Idempotent — skips images already extracted.
          </p>
        </div>
        <button
          onClick={() => void runBatch()}
          disabled={running || isDone || !!noCredsMsg}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {running ? "Running…" : isDone ? "All done" : "Run batch"}
        </button>
      </div>

      {noCredsMsg && (
        <p className="text-xs text-destructive">{noCredsMsg}</p>
      )}

      {progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()} extracted
            </span>
            <span>{progress.pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          {isDone && (
            <p className="text-xs text-green-600 dark:text-green-400">
              All images extracted.
            </p>
          )}
        </div>
      )}

      {lastResult && (
        <p className="text-xs text-muted-foreground">
          Last batch: processed {lastResult.processed}, saved {lastResult.saved},
          no-data {lastResult.noData}, errors {lastResult.errors}
          {lastResult.remaining !== null
            ? `, ${lastResult.remaining} remaining`
            : ""}
          .
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
