"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// D2 — Batch results viewer.
//
// Polls GET /api/platform/image/batch/[id] every 3s while state='running'.
// Groups jobs by parentPostIndex for the §1.7 grouping requirement.
// Approve / reject via POST|PATCH /api/platform/image/jobs/[id]/select.
// Shows auto-attach state badge per job.
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
  createdAt: string;
  jobs: Job[];
}

const ATTACH_BADGE: Record<string, { label: string; colour: string }> = {
  not_applicable: { label: "No date",       colour: "bg-muted text-muted-foreground" },
  pending:        { label: "Will attach",   colour: "bg-blue-100 text-blue-700" },
  attached:       { label: "Attached",      colour: "bg-green-100 text-green-700" },
  attach_failed:  { label: "Attach failed", colour: "bg-red-100 text-red-700" },
};

const RATIO_LABELS: Record<string, string> = {
  "1x1": "1:1", "4x5": "4:5", "9x16": "9:16", "16x9": "16:9", "4x3": "4:3",
};

export function BatchResultsClient({ batchId, companyId }: { batchId: string; companyId: string }) {
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<Record<string, boolean>>({});

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

  async function act(jobId: string, action: "approve" | "reject", reason?: string) {
    setActioning((p) => ({ ...p, [jobId]: true }));
    try {
      const res = await fetch(`/api/platform/image/jobs/${jobId}/select`, {
        method: action === "approve" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId, ...(reason && { reason }) }),
      });
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (json.ok) {
        toast.success(action === "approve" ? "Image approved." : "Image rejected.");
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

  // Group jobs by parentPostIndex.
  const groups = batch.jobs.reduce<Record<number, Job[]>>((acc, j) => {
    const key = j.parentPostIndex ?? 0;
    (acc[key] ??= []).push(j);
    return acc;
  }, {});

  const groupKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);
  const isRunning = batch.state === "running" || batch.state === "pending";

  return (
    <div className="space-y-6">
      {/* Batch header */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{batch.sourceFilename ?? "Unnamed batch"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {batch.totalJobs} jobs · {batch.completedJobs} done · {batch.failedJobs} failed
            {batch.sourceRowCount ? ` · from ${batch.sourceRowCount} rows` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-label="Running" />
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            batch.state === "completed" ? "bg-green-100 text-green-700"
            : batch.state === "failed" ? "bg-red-100 text-red-700"
            : batch.state === "partial" ? "bg-amber-100 text-amber-700"
            : "bg-blue-100 text-blue-700"
          }`}>
            {batch.state.charAt(0).toUpperCase() + batch.state.slice(1)}
          </span>
        </div>
      </div>

      {/* Job groups */}
      {groupKeys.map((groupIdx) => {
        const jobs = groups[groupIdx]!;
        const platforms = jobs[0]?.targetPlatforms ?? [];
        const publishDate = jobs[0]?.targetPublishDate;

        return (
          <section key={groupIdx}>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Post {groupIdx + 1}
              </h2>
              {platforms.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  · {platforms.join(", ")}
                </span>
              )}
              {publishDate && (
                <span className="text-xs text-muted-foreground">
                  · publishes {publishDate}
                </span>
              )}
            </div>

            <div className={`grid gap-3 ${jobs.length === 1 ? "grid-cols-1 max-w-xs" : jobs.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
              {jobs.map((job) => {
                const isActioning = actioning[job.id] ?? false;
                const attachBadge = job.autoAttachState ? ATTACH_BADGE[job.autoAttachState] : null;
                const ratios = job.targetPlatforms?.map((p) => MASS_GEN_PLATFORM_MAP[p]).filter(Boolean) ?? [];
                const ratioLabel = [...new Set(ratios)].map((r) => RATIO_LABELS[r!] ?? r).join(" / ");

                return (
                  <div key={job.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    {/* Image */}
                    <div className="aspect-square bg-muted flex items-center justify-center relative">
                      {job.state === "completed" && job.resultSignedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={job.resultSignedUrl} alt="Generated" className="w-full h-full object-cover" />
                      ) : job.state === "running" || job.state === "pending" ? (
                        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      ) : job.state === "failed" || job.state === "escalated" ? (
                        <p className="text-xs text-destructive text-center px-4">
                          {job.errorClass ?? "Failed"}: {(job.errorDetail ?? "").slice(0, 80)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Pending</p>
                      )}

                      {/* Ratio chip */}
                      {ratioLabel && (
                        <span className="absolute top-2 left-2 rounded-full bg-black/60 text-white text-xs px-2 py-0.5">
                          {ratioLabel}
                        </span>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 space-y-2">
                      {/* Auto-attach badge */}
                      {attachBadge && (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${attachBadge.colour}`}>
                          {attachBadge.label}{publishDate ? ` · ${publishDate}` : ""}
                        </span>
                      )}

                      {/* Approve / reject */}
                      {job.state === "completed" && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 h-8 text-xs"
                            onClick={() => void act(job.id, "approve")}
                            disabled={isActioning}
                          >
                            {isActioning ? "…" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-8 text-xs"
                            onClick={() => void act(job.id, "reject", "Rejected by operator")}
                            disabled={isActioning}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// Inlined from lib/image/types.ts to avoid server-only import in client component.
const MASS_GEN_PLATFORM_MAP: Record<string, string> = {
  linkedin: "1x1", linkedin_landscape: "16x9",
  instagram: "4x5", instagram_story: "9x16",
  facebook: "1x1", facebook_story: "9x16",
  x: "16x9", gbp: "4x3",
};
