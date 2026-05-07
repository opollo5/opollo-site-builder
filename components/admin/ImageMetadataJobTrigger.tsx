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
  const [autoRunning, setAutoRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionSaved, setSessionSaved] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef(false);

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

  // Background progress polling (pauses while auto-run loop handles its own updates).
  useEffect(() => {
    void fetchProgress();
    function schedule() {
      pollTimerRef.current = setTimeout(async () => {
        await fetchProgress();
        if (progress?.remaining !== 0) schedule();
      }, POLL_MS);
    }
    schedule();
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [fetchProgress, progress?.remaining]);

  // Elapsed-time clock while auto-running.
  useEffect(() => {
    if (autoRunning && startedAt !== null) {
      clockRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } else {
      if (clockRef.current) clearInterval(clockRef.current);
    }
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [autoRunning, startedAt]);

  async function postBatch(): Promise<BatchResult | null> {
    try {
      const res = await fetch("/api/admin/jobs/extract-image-metadata", {
        method: "POST",
      });
      const data = (await res.json()) as BatchResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Batch failed");
        return null;
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    }
  }

  async function runBatch() {
    setRunning(true);
    setError(null);
    const result = await postBatch();
    if (result) {
      setLastResult(result);
      await fetchProgress();
    }
    setRunning(false);
  }

  async function runAll() {
    setAutoRunning(true);
    setError(null);
    setSessionSaved(0);
    setStartedAt(Date.now());
    setElapsed(0);
    stopRef.current = false;

    while (!stopRef.current) {
      const result = await postBatch();
      if (!result) break;
      setLastResult(result);
      setSessionSaved((n) => n + result.saved);
      await fetchProgress();
      if (result.done || result.remaining === 0) break;
      // Brief pause between batches so the UI can breathe.
      await new Promise((r) => setTimeout(r, 300));
    }

    setAutoRunning(false);
    setStartedAt(null);
  }

  function stopAll() {
    stopRef.current = true;
  }

  const isDone = progress?.remaining === 0;
  const noCreds = progress && !progress.cfCredsPresent;
  const imgsPerMin =
    elapsed > 5 && sessionSaved > 0
      ? Math.round((sessionSaved / elapsed) * 60)
      : null;

  function fmtElapsed(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">EXIF / IPTC metadata extraction</p>
          <p className="text-xs text-muted-foreground">
            Fetches original image bytes from Cloudflare and writes dimensions,
            dominant colour, captions, tags, and alt text to the library.
            Already-extracted images are skipped automatically.
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {autoRunning ? (
            <button
              onClick={stopAll}
              className="rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={() => void runBatch()}
                disabled={running || isDone || !!noCreds || autoRunning}
                className="rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:bg-muted"
              >
                {running ? "Running…" : "Run one batch"}
              </button>
              <button
                onClick={() => void runAll()}
                disabled={running || isDone || !!noCreds || autoRunning}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90"
              >
                {isDone ? "All done ✓" : "Extract all"}
              </button>
            </>
          )}
        </div>
      </div>

      {noCreds && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Cloudflare credentials not configured —{" "}
          <code>CLOUDFLARE_ACCOUNT_ID</code> and{" "}
          <code>CLOUDFLARE_IMAGES_API_TOKEN</code> must be set on this deployment.
        </p>
      )}

      {progress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()} images
              extracted
            </span>
            <span>{progress.pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          {isDone && (
            <p className="text-xs font-medium text-green-600">
              All images extracted — library is fully indexed.
            </p>
          )}
        </div>
      )}

      {autoRunning && (
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs space-y-0.5">
          <p className="font-medium">Running… {fmtElapsed(elapsed)}</p>
          <p className="text-muted-foreground">
            {sessionSaved} extracted this session
            {imgsPerMin !== null && ` · ~${imgsPerMin} images/min`}
            {lastResult?.remaining != null &&
              ` · ${lastResult.remaining.toLocaleString()} remaining`}
          </p>
        </div>
      )}

      {!autoRunning && lastResult && (
        <p className="text-xs text-muted-foreground">
          Last batch — processed {lastResult.processed}, saved {lastResult.saved},
          skipped {lastResult.noData}, errors {lastResult.errors}
          {lastResult.remaining !== null
            ? `, ${lastResult.remaining.toLocaleString()} remaining`
            : ""}
          .{sessionSaved > 0 && ` Session total: ${sessionSaved} extracted.`}
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
