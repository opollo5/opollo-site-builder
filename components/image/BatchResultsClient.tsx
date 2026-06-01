"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PreviewCard } from "@/components/social/composer/PreviewCard";

// ---------------------------------------------------------------------------
// G — Batch results approval carousel (D8, D9, D10, D24, D25).
//
// Replaces the flat grid with a horizontal, one-card-at-a-time carousel.
// Cards reuse the Composer PreviewCard component (D8, Slice F confirmed reusable).
//
// Actions per card (D10):
//   Approve   → POST /api/platform/image/jobs/[id]/select
//               publish  → "Draft created" + ?compose=<draftId> link
//               download → "Added to download set"
//   Request changes → stub opens Slice I handler (wired when I is built)
//   Reject    → PATCH /api/platform/image/jobs/[id]/select
//
// Server transitions (D24/D25): status returned from API, idempotent guard
// on server. Client carousel reflects server state; never owns it.
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  state: string;
  resultSignedUrl: string | null;
  errorClass: string | null;
  errorDetail: string | null;
  targetPlatforms: string[] | null;
  targetPublishDate: string | null;
  parentPostIndex: number | null;
  postText: string | null;
  autoAttachState?: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface BatchData {
  id: string;
  state: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  sourceFilename: string | null;
  sourceRowCount: number | null;
  destination: "publish" | "download";
  createdAt: string;
  jobs: Job[];
}

// Map generic platform codes to Composer Connection-compatible platform keys.
function platformKey(code: string): "linkedin" | "facebook" | "instagram" | "x" | "google_business_profile" {
  if (code === "linkedin" || code === "linkedin_landscape") return "linkedin";
  if (code === "facebook" || code === "facebook_story") return "facebook";
  if (code === "instagram" || code === "instagram_story") return "instagram";
  if (code === "x") return "x";
  return "linkedin"; // fallback
}

export function BatchResultsClient({ batchId, companyId }: { batchId: string; companyId: string }) {
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [actioning, setActioning] = useState<Record<string, boolean>>({});
  // Track per-job action outcomes so approved/rejected cards show status.
  const [outcomes, setOutcomes] = useState<Record<string, {
    status: "approved_publish" | "approved_download" | "rejected";
    draftId?: string;
  }>>({});

  const fetchBatch = useCallback(async () => {
    const res = await fetch(`/api/platform/image/batch/${batchId}`);
    if (!res.ok) return;
    const json = await res.json() as { ok: boolean; data?: BatchData };
    if (json.ok && json.data) setBatch(json.data);
    setLoading(false);
  }, [batchId]);

  // Poll while running.
  useEffect(() => {
    void fetchBatch();
    const interval = setInterval(() => {
      if (batch?.state === "running" || batch?.state === "pending") void fetchBatch();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchBatch, batch?.state]);

  function navigateTo(index: number) {
    if (transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrentIndex(index);
      setTransitioning(false);
    }, 180);
  }

  async function act(jobId: string, action: "approve" | "reject") {
    setActioning((p) => ({ ...p, [jobId]: true }));
    try {
      const res = await fetch(`/api/platform/image/jobs/${jobId}/select`, {
        method: action === "approve" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, ...(action === "reject" && { reason: "Rejected by operator" }) }),
      });
      const json = await res.json() as {
        ok: boolean;
        data?: { destination?: string; addedToDownloadSet?: boolean; autoAttach?: { draftId?: string }; draftId?: string };
        error?: { message: string };
      };

      if (json.ok) {
        const dest = json.data?.destination ?? batch?.destination ?? "publish";
        if (action === "approve") {
          if (dest === "download") {
            setOutcomes((p) => ({ ...p, [jobId]: { status: "approved_download" } }));
            toast.success("Added to download set.");
          } else {
            const draftId = json.data?.autoAttach?.draftId;
            setOutcomes((p) => ({ ...p, [jobId]: { status: "approved_publish", draftId } }));
            toast.success(draftId ? "Draft created." : "Approved.");
          }
          // Auto-advance to next pending card.
          const completedJobs = batch?.jobs ?? [];
          const nextIdx = completedJobs.findIndex((j, i) => i > currentIndex && j.state === "completed" && !outcomes[j.id]);
          if (nextIdx !== -1) navigateTo(nextIdx);
        } else {
          setOutcomes((p) => ({ ...p, [jobId]: { status: "rejected" } }));
          toast.success("Rejected.");
        }
        void fetchBatch();
      } else {
        toast.error(json.error?.message ?? `${action} failed.`);
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setActioning((p) => ({ ...p, [jobId]: false }));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;
  if (!batch) return <p className="text-sm text-destructive py-8 text-center">Batch not found.</p>;

  const isRunning = batch.state === "running" || batch.state === "pending";
  const completedJobs = batch.jobs.filter((j) => j.state === "completed");
  const total = completedJobs.length;

  const currentJob = completedJobs[currentIndex];
  const outcome = currentJob ? outcomes[currentJob.id] : null;
  const primaryPlatform = currentJob?.targetPlatforms?.[0] ?? "linkedin";
  const platform = platformKey(primaryPlatform);

  // Minimal Connection stub so PreviewCard renders correctly.
  const connectionStub = { id: "preview", platform, account_name: platform, account_avatar_url: "" };

  return (
    <div className="space-y-6" data-testid="batch-results-carousel">
      {/* Batch header */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{batch.sourceFilename ?? "Unnamed batch"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {batch.totalJobs} jobs · {batch.completedJobs} done · {batch.failedJobs} failed
            {batch.sourceRowCount ? ` · from ${batch.sourceRowCount} rows` : ""}
            {" · "}
            <span className="capitalize">{batch.destination}</span> mode
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-label="Running" />}
          {batch.destination === "download" && batch.completedJobs > 0 && !isRunning && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/platform/image/batch/${batchId}/download?company_id=${companyId}`} download>
                Download approved
              </a>
            </Button>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${batch.state === "completed" ? "bg-green-100 text-green-700" : batch.state === "failed" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
            {batch.state.charAt(0).toUpperCase() + batch.state.slice(1)}
          </span>
        </div>
      </div>

      {total === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {isRunning ? "Images are being generated…" : "No completed images yet."}
        </div>
      )}

      {total > 0 && currentJob && (
        <div className="space-y-4">
          {/* Numbering (D9) */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground" data-testid="carousel-numbering">
              {currentIndex + 1} of {total}
            </p>
            {/* Navigation dots */}
            <div className="flex gap-1.5">
              {completedJobs.map((_, i) => (
                <button
                  key={i}
                  onClick={() => navigateTo(i)}
                  className={`h-2 w-2 rounded-full transition-colors ${i === currentIndex ? "bg-primary" : "bg-border hover:bg-muted-foreground"}`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentIndex === 0} onClick={() => navigateTo(currentIndex - 1)}>← Prev</Button>
              <Button variant="outline" size="sm" disabled={currentIndex === total - 1} onClick={() => navigateTo(currentIndex + 1)}>Next →</Button>
            </div>
          </div>

          {/* Carousel card — fade transition (D9) */}
          <div
            className={`transition-opacity duration-[180ms] ${transitioning ? "opacity-0" : "opacity-100"}`}
            data-testid="carousel-card"
          >
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Platform + caption header (D9) */}
              <div className="px-5 pt-4 pb-3 border-b border-border space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{platform}</span>
                  {currentJob.targetPublishDate && (
                    <span className="text-xs text-muted-foreground">· {currentJob.targetPublishDate}</span>
                  )}
                </div>
                {currentJob.postText && (
                  <p className="text-sm text-foreground line-clamp-2">{currentJob.postText}</p>
                )}
              </div>

              {/* Preview — reuses Composer PreviewCard (D8) */}
              <div className="flex justify-center bg-muted/20 p-6">
                {currentJob.resultSignedUrl ? (
                  <div className="max-w-sm w-full">
                    <PreviewCard
                      platform={platform}
                      content={currentJob.postText ?? ""}
                      mediaUrls={[currentJob.resultSignedUrl]}
                      connection={connectionStub}
                    />
                  </div>
                ) : (
                  <div className="flex h-48 w-full max-w-sm items-center justify-center rounded-xl bg-muted">
                    <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                )}
              </div>

              {/* Actions (D10) */}
              <div className="px-5 py-4 border-t border-border">
                {outcome ? (
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${
                      outcome.status === "approved_publish" ? "bg-green-100 text-green-700"
                      : outcome.status === "approved_download" ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                    }`} data-testid="card-outcome">
                      {outcome.status === "approved_publish" ? "Draft created" : outcome.status === "approved_download" ? "In download set" : "Rejected"}
                    </span>
                    {outcome.status === "approved_publish" && outcome.draftId && (
                      <a href={`/company/social/posts?compose=${outcome.draftId}`} className="text-sm text-primary underline">
                        Open in Composer →
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => void act(currentJob.id, "approve")}
                      disabled={actioning[currentJob.id] ?? false}
                      data-testid="approve-btn"
                    >
                      {batch.destination === "download" ? "Add to download" : "Approve"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toast("Request changes coming in Slice I.")}
                      data-testid="request-changes-btn"
                    >
                      Request changes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:border-destructive"
                      onClick={() => void act(currentJob.id, "reject")}
                      disabled={actioning[currentJob.id] ?? false}
                      data-testid="reject-btn"
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Failed jobs summary */}
      {batch.jobs.filter((j) => j.state === "failed").length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {batch.jobs.filter((j) => j.state === "failed").length} image(s) failed to generate.
        </div>
      )}
    </div>
  );
}
