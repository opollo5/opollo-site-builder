"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PreviewCard } from "@/components/social/composer/PreviewCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Connection, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// G — Batch results approval carousel (D8, D9, D10, D24, D25).
//
// Phase 1 wireframe changes (Step 5):
//   - Removed duplicate caption/platform/date block above preview (Change 1)
//   - Resolved real social connections from API (Change 2)
//   - Fixed always-visible PageProof-style action bar (Change 3)
//   - Comment dialog for Reject and Request changes (Change 4 / L17)
//
// Lane layout: active card is full-size + lifted; upcoming cards to the right
// are smaller and dimmed so the operator sees what's coming. Approve/reject
// triggers a fly-up exit on the departing card while the next card slides in.
//
// Animation mechanism: CSS transitions (transform + opacity) for lane shifts,
// CSS keyframes (.card-lane-exit in globals.css) for the exit fly-out.
// Matches the c3-snap easing used throughout the Composer. Respects
// prefers-reduced-motion (instant advance when set).
//
// Actions per card (D10):
//   Approve         → POST /api/platform/image/jobs/[id]/select
//                     publish  → "Draft created" + ?compose=<draftId> link
//                     download → "Added to download set"
//   Request changes → PATCH with requestChanges:true + comment (L17)
//   Reject          → PATCH with reason + comment (L17)
//
// Server transitions (D24/D25): status returned from API, idempotent guard
// on server. Client carousel reflects server state; never owns it.
// ---------------------------------------------------------------------------

interface ResolvedConnection {
  profileId: string;
  platform: string;
  accountName: string | null;
  avatarUrl: string | null;
}

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
  resolvedConnections: ResolvedConnection[] | null;
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
  approvalStatus: string | null;
  reviewRound: number | null;
  jobs: Job[];
}

// Map generic platform codes or DB platform names to Composer Platform type.
function platformKey(code: string): Platform {
  if (code === "linkedin" || code === "linkedin_landscape" || code === "linkedin_company" || code === "linkedin_personal") return "linkedin";
  if (code === "facebook" || code === "facebook_story" || code === "facebook_page") return "facebook";
  if (code === "instagram" || code === "instagram_story" || code === "instagram_business") return "instagram";
  if (code === "x") return "x";
  if (code === "gbp") return "google_business_profile";
  return "linkedin"; // fallback
}

// Lane positioning helpers — drive the CSS transform + opacity for each card
// based on its offset from the active card (0 = active, 1 = next, 2 = peek…).
function laneTransform(offset: number): string {
  if (offset === 0) return "none";
  if (offset === 1) return "translateX(62%) scale(0.88)";
  if (offset === 2) return "translateX(112%) scale(0.80)";
  return "translateX(140%) scale(0.74)";
}
function laneOpacity(offset: number): number {
  if (offset === 0) return 1;
  if (offset === 1) return 0.65;
  if (offset === 2) return 0.35;
  return 0;
}
function laneZ(offset: number): number {
  return Math.max(10 - offset, 7);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

export function BatchResultsClient({ batchId, companyId }: { batchId: string; companyId: string }) {
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  // exitingIndex: the card currently playing its fly-out animation.
  // Set to the old currentIndex simultaneously with advancing currentIndex so
  // the exit animation and lane slide-in play at the same time.
  const [exitingIndex, setExitingIndex] = useState<number | null>(null);
  const [actioning, setActioning] = useState<Record<string, boolean>>({});
  // Track per-job action outcomes so approved/rejected cards show status.
  const [outcomes, setOutcomes] = useState<Record<string, {
    status: "approved_publish" | "approved_download" | "rejected";
    draftId?: string;
  }>>({});

  // Change 4: Comment dialog state
  const [commentDialog, setCommentDialog] = useState<{ jobId: string; action: "reject" | "request_changes" } | null>(null);
  const [commentText, setCommentText] = useState("");

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
    if (exitingIndex !== null) return;
    if (prefersReducedMotion()) {
      setCurrentIndex(index);
      return;
    }
    // React 18 batches these two setState calls into one render so the
    // exit animation and the lane slide-in start simultaneously.
    setExitingIndex(currentIndex);
    setCurrentIndex(index);
    setTimeout(() => setExitingIndex(null), 380);
  }

  // Change 4: open comment dialog helper
  function openCommentDialog(jobId: string, action: "reject" | "request_changes") {
    setCommentText("");
    setCommentDialog({ jobId, action });
  }

  // Change 4: act() now accepts an optional comment
  async function act(jobId: string, action: "approve" | "reject" | "request_changes", comment?: string) {
    setActioning((p) => ({ ...p, [jobId]: true }));
    try {
      const method = action === "approve" ? "POST" : "PATCH";
      const body: Record<string, unknown> = { company_id: companyId };
      if (action !== "approve") {
        body.reason = comment ?? "";
        if (action === "request_changes") body.requestChanges = true;
      }
      const res = await fetch(`/api/platform/image/jobs/${jobId}/select`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        } else {
          setOutcomes((p) => ({ ...p, [jobId]: { status: "rejected" } }));
          toast.success(action === "request_changes" ? "Changes requested." : "Rejected.");
        }
        // Auto-advance to next undecided card after approve OR reject.
        const allJobs = batch?.jobs ?? [];
        const nextIdx = allJobs
          .filter((j) => j.state === "completed")
          .findIndex((j, i) => i > currentIndex && !outcomes[j.id] && j.id !== jobId);
        if (nextIdx !== -1) navigateTo(nextIdx);
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
          {batch.completedJobs > 0 && !isRunning && (
            <Button
              variant="outline"
              size="sm"
              asChild
            >
              <a
                href={`/api/platform/image/batch/${batchId}/download?company_id=${companyId}`}
                download
              >
                Download all ({batch.completedJobs})
              </a>
            </Button>
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

      {total === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          {isRunning ? "Images are being generated…" : "No completed images yet."}
        </div>
      )}

      {total > 0 && (
        <div className="space-y-4">
          {/* ── Lane: all cards stacked in a CSS grid; transforms position them ── */}
          {/* Active card (offset 0) renders in normal flow, setting container height.  */}
          {/* Upcoming cards (offset 1, 2) sit absolutely on top, scaled + dimmed.      */}
          {/* Exiting card plays the .card-lane-exit fly-up animation as an overlay.     */}
          <div className="relative grid overflow-hidden">
            {completedJobs.map((job, i) => {
              const offset = i - currentIndex;
              const isExiting = exitingIndex === i;
              // Render: active + 2 upcoming + the card currently exiting.
              // offset < 0 cards (prev) are hidden — prev navigation snaps instantly.
              const isVisible = isExiting || (offset >= 0 && offset <= 2);
              if (!isVisible) return null;

              const jobOutcome = outcomes[job.id];
              const jobPlatform = platformKey(job.targetPlatforms?.[0] ?? "linkedin");

              // Change 2: use resolved connection if available, fall back to stub.
              // Map DB platform names (e.g. linkedin_company) to Composer Platform type.
              const conn = job.resolvedConnections?.[0];
              const jobConnection: Connection = conn
                ? { id: conn.profileId, platform: platformKey(conn.platform), account_name: conn.accountName ?? conn.platform, account_avatar_url: conn.avatarUrl ?? "" }
                : { id: "preview", platform: jobPlatform, account_name: jobPlatform, account_avatar_url: "" };

              return (
                <div
                  key={job.id}
                  // Active card: col/row 1 in normal flow (sets container height).
                  // All others: absolute overlay so they don't push layout.
                  className={cn(
                    "col-start-1 row-start-1 transition-[transform,opacity] duration-[420ms] ease-c3-snap",
                    !isExiting && offset !== 0 && "absolute inset-x-0 top-0",
                    isExiting && "absolute inset-x-0 top-0 card-lane-exit",
                  )}
                  style={isExiting
                    ? { zIndex: 20 }
                    : { transform: laneTransform(offset), opacity: laneOpacity(offset), zIndex: laneZ(offset), pointerEvents: offset === 0 ? "auto" : "none" }
                  }
                  data-testid={offset === 0 && !isExiting ? "carousel-card" : undefined}
                  aria-hidden={offset !== 0 || isExiting}
                >
                  {/* Change 1: removed duplicate caption/platform/date block above preview */}
                  {/* Change 3: flex-col card with sticky bottom action bar */}
                  <div className={cn(
                    "rounded-xl border border-border bg-card overflow-hidden flex flex-col",
                    offset === 0 && !isExiting && "shadow-md ring-1 ring-primary/10",
                  )}>
                    {/* Preview fills remaining space */}
                    <div className="flex-1 flex justify-center bg-muted/20 p-6">
                      {job.resultSignedUrl ? (
                        <div className="max-w-sm w-full">
                          <PreviewCard
                            platform={jobPlatform}
                            content={job.postText ?? ""}
                            mediaUrls={[job.resultSignedUrl]}
                            connection={jobConnection}
                          />
                        </div>
                      ) : (
                        <div className="flex h-48 w-full max-w-sm items-center justify-center rounded-xl bg-muted">
                          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Change 3: Sticky action bar — always visible at bottom */}
                    <div className="sticky bottom-0 border-t border-border bg-card px-5 py-4">
                      {jobOutcome ? (
                        <div className="flex items-center gap-3">
                          <span className={`rounded-full px-3 py-1 text-sm font-medium ${
                            jobOutcome.status === "approved_publish" ? "bg-green-100 text-green-700"
                            : jobOutcome.status === "approved_download" ? "bg-blue-100 text-blue-700"
                            : "bg-red-100 text-red-700"
                          }`} data-testid={offset === 0 && !isExiting ? "card-outcome" : undefined}>
                            {jobOutcome.status === "approved_publish" ? "Draft created" : jobOutcome.status === "approved_download" ? "In download set" : "Rejected"}
                          </span>
                          {jobOutcome.status === "approved_publish" && jobOutcome.draftId && (
                            <a href={`/company/social/posts?compose=${jobOutcome.draftId}`} className="text-sm text-primary underline">
                              Open in Composer →
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          {/* Left: round indicator (only when approvalStatus is set) */}
                          {batch.approvalStatus && batch.approvalStatus !== "none" && (
                            <span className="text-sm text-muted-foreground">
                              Round {(batch.reviewRound ?? 0) + 1} of 3
                            </span>
                          )}

                          {/* Center: position + dots navigation */}
                          <div className="flex-1 flex items-center justify-center gap-3">
                            <button
                              disabled={currentIndex === 0 || exitingIndex !== null}
                              onClick={() => navigateTo(currentIndex - 1)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                              aria-label="Previous image"
                            >
                              ←
                            </button>
                            <span
                              className="text-sm text-muted-foreground"
                              data-testid={offset === 0 && !isExiting ? "carousel-numbering" : undefined}
                            >
                              {currentIndex + 1} of {total}
                            </span>
                            <div className="flex gap-1">
                              {completedJobs.map((_, dotIdx) => (
                                <button
                                  key={dotIdx}
                                  onClick={() => navigateTo(dotIdx)}
                                  className={`h-1.5 w-1.5 rounded-full transition-colors ${dotIdx === currentIndex ? "bg-primary" : "bg-border"}`}
                                  aria-label={`Go to image ${dotIdx + 1}`}
                                />
                              ))}
                            </div>
                            <button
                              disabled={currentIndex === total - 1 || exitingIndex !== null}
                              onClick={() => navigateTo(currentIndex + 1)}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                              aria-label="Next image"
                            >
                              →
                            </button>
                          </div>

                          {/* Right: action buttons */}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white font-semibold"
                              onClick={() => void act(job.id, "approve")}
                              disabled={(actioning[job.id] ?? false) || offset !== 0}
                              data-testid={offset === 0 && !isExiting ? "approve-btn" : undefined}
                            >
                              {batch.destination === "download" ? "Add to download" : "Approve"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openCommentDialog(job.id, "request_changes")}
                              disabled={offset !== 0}
                              data-testid={offset === 0 && !isExiting ? "request-changes-btn" : undefined}
                            >
                              Request changes
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:border-destructive"
                              onClick={() => openCommentDialog(job.id, "reject")}
                              disabled={offset !== 0}
                              data-testid={offset === 0 && !isExiting ? "reject-btn" : undefined}
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Failed jobs summary */}
      {batch.jobs.filter((j) => j.state === "failed").length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {batch.jobs.filter((j) => j.state === "failed").length} image(s) failed to generate.
        </div>
      )}

      {/* Change 4: Comment dialog for Reject and Request changes (L17) */}
      <Dialog open={commentDialog !== null} onOpenChange={(open) => { if (!open) setCommentDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {commentDialog?.action === "reject" ? "Reject image" : "Request changes"}
            </DialogTitle>
            <DialogDescription>
              {commentDialog?.action === "reject"
                ? "Explain why this image is being rejected. This will be sent to the creator."
                : "Describe what changes are needed. This will be sent to the creator."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Add a comment (required, min 10 characters)…"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="min-h-[120px]"
              data-testid="comment-dialog-textarea"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommentDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={commentDialog?.action === "reject" ? "destructive" : "default"}
              disabled={commentText.trim().length < 10 || (commentDialog !== null && (actioning[commentDialog.jobId] ?? false))}
              data-testid="comment-dialog-submit"
              onClick={() => {
                if (!commentDialog) return;
                void act(commentDialog.jobId, commentDialog.action, commentText.trim()).then(() => {
                  setCommentDialog(null);
                });
              }}
            >
              {commentDialog?.action === "reject" ? "Reject" : "Request changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
