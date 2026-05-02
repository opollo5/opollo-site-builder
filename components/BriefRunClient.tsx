"use client";

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  StatusPill,
  pageStatusKind,
  runStatusKind,
} from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { RunCostTicker } from "@/components/RunCostTicker";
import type {
  BriefPageCritiqueEntry,
  BriefPageQualityFlag,
  BriefPageRow,
  BriefPageStatus,
  BriefRow,
  BriefRunSnapshot,
} from "@/lib/briefs";
import { wrapForPreview } from "@/lib/preview-iframe-wrapper";
import { usePoll } from "@/lib/use-poll";

// RS-4 — payload shape returned by /api/briefs/[brief_id]/run/snapshot.
// Mirrored locally so this component doesn't import from the route file.
interface RunSnapshotPayload {
  brief: BriefRow;
  pages: BriefPageRow[];
  active_run: BriefRunSnapshot | null;
  remaining_budget_cents: number;
  estimate_cents: number;
}

interface RunSnapshotEnvelope {
  ok: boolean;
  data?: RunSnapshotPayload;
}

// ---------------------------------------------------------------------------
// M12-5 — /admin/sites/[id]/briefs/[brief_id]/run client component.
//
// Owns the run-control state machine + three operator actions:
//   - Start run (with CONFIRMATION_REQUIRED dialog if cost > 50% budget)
//   - Approve current page (advances runner to the next ordinal)
//   - Revise with note (captures operator feedback + re-queues the page)
//   - Cancel run (idempotent, leaves generated pages in place)
//
// Renders:
//   - Run status + cost rollup banner
//   - Per-page list with status pill + quality_flag badge
//   - Expanded preview on the current "awaiting_review" page:
//       * sanitized draft_html in an iframe sandbox
//       * last visual_critique text (if present)
//       * approve / revise buttons
//
// VERSION_CONFLICT on any action surfaces inline — matches M8-5's
// budget-editor shape. Operator refreshes to pick up the server state.
// ---------------------------------------------------------------------------

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type ControlState = "idle" | "starting" | "confirming" | "cancelling" | "acting";

// STATUS_LABELS / QUALITY_FLAG_COPY / RUN_STATUS_LABELS folded to A-4's
// StatusPill primitive. Hint text for quality flags is now passed via
// the title attribute below at the call site.

const QUALITY_FLAG_HINT: Record<BriefPageQualityFlag, string> = {
  cost_ceiling:
    "The visual review halted before converging because this page hit its per-page cost ceiling. The current draft is the best version the runner produced within budget.",
  capped_with_issues:
    "The 2-iteration visual review cap was reached while the critique still flagged severity-high issues. Review the critique notes below before approving.",
};

const QUALITY_FLAG_KIND: Record<
  BriefPageQualityFlag,
  "quality_cost_ceiling" | "quality_capped_with_issues"
> = {
  cost_ceiling: "quality_cost_ceiling",
  capped_with_issues: "quality_capped_with_issues",
};

const ERROR_TRANSLATIONS: Record<string, string> = {
  CONFIRMATION_REQUIRED:
    "This run's estimated cost exceeds 50% of your remaining monthly budget. Confirm to proceed.",
  BRIEF_RUN_ALREADY_ACTIVE:
    "There's already an active run for this brief. Cancel it before starting a new one.",
  VERSION_CONFLICT:
    "Another tab changed this page while you were reviewing. Refresh to see the latest state, then retry.",
  INVALID_STATE:
    "This action isn't available for the page's current state. Refresh and retry.",
  NOT_FOUND:
    "We couldn't find the brief or page. It may have been deleted — refresh to confirm.",
};

export function BriefRunClient({
  siteId,
  siteName,
  brief: initialBrief,
  pages: initialPages,
  activeRun: initialActiveRun,
  estimateCents: initialEstimateCents,
  remainingBudgetCents: initialRemainingBudgetCents,
}: {
  siteId: string;
  siteName: string;
  brief: BriefRow;
  pages: BriefPageRow[];
  activeRun: BriefRunSnapshot | null;
  estimateCents: number;
  remainingBudgetCents: number;
}) {
  const [controlState, setControlState] = useState<ControlState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState<string | null>(null); // page id
  const [reviseNote, setReviseNote] = useState("");

  // RS-4 — poll the snapshot endpoint every 4s. The initial server-render
  // hydrates the surface; live updates flow in via `polled.data`. After
  // every successful mutation (start / approve / revise / cancel) we call
  // `refresh` so the UI doesn't wait up to 4s for the next tick.
  const polled = usePoll<RunSnapshotEnvelope>(
    `/api/briefs/${initialBrief.id}/run/snapshot`,
  );

  const live = polled.data?.ok ? polled.data.data : undefined;
  const brief = live?.brief ?? initialBrief;
  const pages = live?.pages ?? initialPages;
  const activeRun = live?.active_run ?? initialActiveRun;
  const remainingBudgetCents =
    live?.remaining_budget_cents ?? initialRemainingBudgetCents;
  const estimateCents = live?.estimate_cents ?? initialEstimateCents;

  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.ordinal - b.ordinal),
    [pages],
  );

  // RS-5 — first awaiting-review page (defensive — runner only ever has
  // one at a time, but if a future race lands two, we point at the
  // earliest ordinal so the operator works through them in order).
  const firstAwaitingReview = useMemo(
    () => sortedPages.find((p) => p.page_status === "awaiting_review") ?? null,
    [sortedPages],
  );

  function scrollToPageCard(pageId: string) {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`page-card-${pageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // After the smooth scroll begins, focus the card so screen-readers
    // jump along with the visual focus.
    el.focus({ preventScroll: true });
  }

  const isRunTerminal =
    activeRun?.status === "succeeded" ||
    activeRun?.status === "failed" ||
    activeRun?.status === "cancelled";

  const isRunActive =
    activeRun !== null && !isRunTerminal; // queued | running | paused

  const canStartRun = !activeRun || isRunTerminal;

  function errorFor(code: string, fallback: string): string {
    return ERROR_TRANSLATIONS[code] ?? fallback;
  }

  async function handleStartRun(confirmed: boolean) {
    setControlState("starting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/briefs/${brief.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const payload = (await res.json()) as {
        ok: boolean;
        data?: unknown;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setControlState("idle");
        setConfirmOpen(false);
        void polled.refresh();
        return;
      }
      if (payload.error?.code === "CONFIRMATION_REQUIRED") {
        setConfirmOpen(true);
        setControlState("idle");
        return;
      }
      setErrorMessage(
        errorFor(
          payload.error?.code ?? "INTERNAL_ERROR",
          payload.error?.message ?? `Start failed (HTTP ${res.status}).`,
        ),
      );
      setControlState("idle");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setControlState("idle");
    }
  }

  async function handleCancel() {
    setControlState("cancelling");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/briefs/${brief.id}/cancel`, {
        method: "POST",
      });
      const payload = (await res.json()) as {
        ok: boolean;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setControlState("idle");
        void polled.refresh();
        return;
      }
      setErrorMessage(
        errorFor(
          payload.error?.code ?? "INTERNAL_ERROR",
          payload.error?.message ?? `Cancel failed (HTTP ${res.status}).`,
        ),
      );
      setControlState("idle");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setControlState("idle");
    }
  }

  async function handleApprove(page: BriefPageRow) {
    setControlState("acting");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/briefs/${brief.id}/pages/${page.id}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: page.version_lock,
          }),
        },
      );
      const payload = (await res.json()) as {
        ok: boolean;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setControlState("idle");
        void polled.refresh();
        return;
      }
      setErrorMessage(
        errorFor(
          payload.error?.code ?? "INTERNAL_ERROR",
          payload.error?.message ?? `Approve failed (HTTP ${res.status}).`,
        ),
      );
      setControlState("idle");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setControlState("idle");
    }
  }

  async function handleRevise(page: BriefPageRow) {
    if (!reviseNote.trim()) {
      setErrorMessage("Add a note describing what to change.");
      return;
    }
    setControlState("acting");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/briefs/${brief.id}/pages/${page.id}/revise`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_version_lock: page.version_lock,
            note: reviseNote,
          }),
        },
      );
      const payload = (await res.json()) as {
        ok: boolean;
        error?: { code: string; message: string };
      };
      if (res.ok && payload.ok) {
        setControlState("idle");
        setReviseOpen(null);
        setReviseNote("");
        void polled.refresh();
        return;
      }
      setErrorMessage(
        errorFor(
          payload.error?.code ?? "INTERNAL_ERROR",
          payload.error?.message ?? `Revise failed (HTTP ${res.status}).`,
        ),
      );
      setControlState("idle");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setControlState("idle");
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{brief.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run surface for <span className="font-medium">{siteName}</span>
            {activeRun && (
              <>
                {" — "}
                {/* RS-5 — when a specific page is awaiting review, the
                    run-level pill becomes a clickable shortcut showing
                    the ordinal so the operator knows exactly which page
                    is blocking. Falls back to the static pill when no
                    page is awaiting (defensive). */}
                {activeRun.status === "paused" && firstAwaitingReview ? (
                  <StatusPill
                    kind="run_paused"
                    role="button"
                    tabIndex={0}
                    onClick={() => scrollToPageCard(firstAwaitingReview.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        scrollToPageCard(firstAwaitingReview.id);
                      }
                    }}
                    className="cursor-pointer hover:bg-warning/20 focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label={`Page ${firstAwaitingReview.ordinal + 1} (${firstAwaitingReview.title}) awaiting your review — jump to card`}
                    label={
                      <>
                        Page {firstAwaitingReview.ordinal + 1} awaiting your
                        review →
                      </>
                    }
                  />
                ) : (
                  <RunStatusPill status={activeRun.status} />
                )}
              </>
            )}
            {/* RS-4 — discreet stale indicator. Only renders when the
                last successful poll is more than 8s old (intervalMs * 2),
                so a single late tick doesn't flicker the badge. */}
            {polled.isStale && (
              <span
                role="status"
                className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground"
                title="Live updates paused — retrying"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Reconnecting…
              </span>
            )}
          </p>
        </div>
        {isRunActive && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={controlState !== "idle"}
          >
            {controlState === "cancelling" ? "Cancelling…" : "Cancel run"}
          </Button>
        )}
      </div>

      {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}

      {/* RS-6 — inline cost section dropped; the floating RunCostTicker
          (rendered at the page root, fixed bottom-right / bottom-bar)
          carries the same data plus a per-page breakdown. */}

      {canStartRun && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            onClick={() => handleStartRun(false)}
            disabled={controlState !== "idle"}
          >
            {controlState === "starting" ? "Starting…" : "Start run"}
          </Button>
        </div>
      )}

      {activeRun?.status === "failed" && activeRun.failure_code && (
        <Alert
          variant="destructive"
          title={
            <>
              Run failed:{" "}
              <code className="text-sm">{activeRun.failure_code}</code>
            </>
          }
        >
          {activeRun.failure_detail && <p>{activeRun.failure_detail}</p>}
        </Alert>
      )}

      <section aria-label="Pages">
        <h2 className="text-base font-semibold">Pages</h2>
        <ol className="mt-3 space-y-3">
          {sortedPages.map((page) => {
            const isExpanded =
              page.page_status === "awaiting_review" ||
              page.page_status === "failed" ||
              page.page_status === "approved";
            const isAwaitingReview = page.page_status === "awaiting_review";
            return (
              <li
                key={page.id}
                // RS-5 — id + tabIndex give the run-level "Page N
                // awaiting your review" badge a target for
                // scrollIntoView + focus().
                id={`page-card-${page.id}`}
                tabIndex={-1}
                className={
                  isAwaitingReview
                    ? "rounded-lg border-2 border-warning/60 bg-warning/5 p-4 ring-2 ring-warning/20 transition-smooth focus-visible:outline-none focus-visible:ring-warning/40"
                    : "rounded-lg border p-4 transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                }
                aria-labelledby={`page-${page.id}-title`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3
                      id={`page-${page.id}-title`}
                      className="text-base font-medium"
                    >
                      {page.ordinal + 1}. {page.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <PageStatusPill status={page.page_status} />
                      {page.quality_flag && (
                        <QualityFlagBadge flag={page.quality_flag} />
                      )}
                      <span className="text-muted-foreground">
                        Cost:{" "}
                        <span className="font-mono">
                          {centsToUsd(Number(page.page_cost_cents ?? 0))}
                        </span>
                      </span>
                    </div>
                  </div>
                  {isAwaitingReview && (
                    <Button
                      type="button"
                      size="sm"
                      // h-11 keeps the 44px tap target (mobile floor).
                      className="h-11 shrink-0"
                      onClick={() => scrollToPageCard(page.id)}
                      aria-label={`Review page ${page.ordinal + 1}: ${page.title}`}
                    >
                      Review now →
                    </Button>
                  )}
                </div>

                {isExpanded && (
                  <PagePreview
                    page={page}
                    briefId={brief.id}
                    isCurrentAwaitingReview={isAwaitingReview}
                    controlState={controlState}
                    onApprove={() => handleApprove(page)}
                    onRevise={() => setReviseOpen(page.id)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {confirmOpen && (
        <ConfirmationModal
          estimateCents={estimateCents}
          remainingBudgetCents={remainingBudgetCents}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => handleStartRun(true)}
          submitting={controlState === "starting"}
        />
      )}

      {reviseOpen && (
        <ReviseModal
          note={reviseNote}
          onNoteChange={setReviseNote}
          onCancel={() => {
            setReviseOpen(null);
            setReviseNote("");
          }}
          onConfirm={() => {
            const page = sortedPages.find((p) => p.id === reviseOpen);
            if (page) handleRevise(page);
          }}
          submitting={controlState === "acting"}
        />
      )}

      <RunCostTicker
        estimateCents={estimateCents}
        remainingBudgetCents={remainingBudgetCents}
        spentCents={Number(activeRun?.run_cost_cents ?? 0)}
        pages={sortedPages}
        textModel={brief.text_model}
        visualModel={brief.visual_model}
      />
    </div>
  );
}

function RunStatusPill({
  status,
}: {
  status: BriefRunSnapshot["status"];
}) {
  return <StatusPill kind={runStatusKind(status)} />;
}

function PageStatusPill({ status }: { status: BriefPageStatus }) {
  return <StatusPill kind={pageStatusKind(status)} />;
}

function QualityFlagBadge({ flag }: { flag: BriefPageQualityFlag }) {
  return (
    <StatusPill
      kind={QUALITY_FLAG_KIND[flag]}
      title={QUALITY_FLAG_HINT[flag]}
      label={
        <>
          <TriangleAlert aria-hidden className="h-3 w-3" />
          {flag === "cost_ceiling" ? "Cost ceiling hit" : "Capped with issues"}
        </>
      }
    />
  );
}

function PagePreview({
  page,
  isCurrentAwaitingReview,
  controlState,
  onApprove,
  onRevise,
}: {
  page: BriefPageRow;
  briefId: string;
  isCurrentAwaitingReview: boolean;
  controlState: ControlState;
  onApprove: () => void;
  onRevise: () => void;
}) {
  const html = page.generated_html ?? page.draft_html ?? "";
  // Belt-and-suspenders: even after the runner's structural gate (PR
  // #188), an operator-edited or legacy row could still hold a
  // truncated doc. Surface a banner above the iframe so a black/blank
  // preview is never silent. Trigger if the doc claims completeness
  // (<!DOCTYPE / <html opener) AND is missing closing </body> or
  // </html>. Bare fragments — which never claim to be complete docs —
  // skip the check.
  const looksTruncated = useMemo(() => {
    if (!html) return false;
    const trimmed = html.trimEnd();
    const claimsCompleteness =
      /<!DOCTYPE\s+html\b/i.test(trimmed) || /<html[\s>]/i.test(trimmed);
    if (!claimsCompleteness) return false;
    return !/<\/body\s*>/i.test(trimmed) || !/<\/html\s*>$/i.test(trimmed);
  }, [html]);
  const lastVisualCritique = useMemo(() => {
    const log = (page.critique_log ?? []) as BriefPageCritiqueEntry[];
    return [...log]
      .reverse()
      .find((e) => e.pass_kind === "visual_critique");
  }, [page.critique_log]);

  return (
    <div className="mt-4 space-y-3">
      {html ? (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Show rendered preview
          </summary>
          {looksTruncated && (
            <Alert
              variant="destructive"
              className="mt-2"
              title="This page's HTML appears truncated."
            >
              The doc is missing a closing{" "}
              <code className="font-mono">&lt;/body&gt;</code> or{" "}
              <code className="font-mono">&lt;/html&gt;</code> tag, so the
              preview below may render as a blank or solid-coloured frame.
              Review the source carefully or click <em>Revise</em> to
              regenerate.
            </Alert>
          )}
          <iframe
            // Sandbox prevents scripts, plugins, forms, popups from the
            // preview. draft_html is Claude-generated and already passes
            // the runner's quality gates, but belt-and-suspenders: render
            // it in a constrained frame.
            //
            // PB-3 (2026-04-29): wrapForPreview wraps path-B fragments in
            // a synthetic doc with a shim stylesheet that approximates
            // WP/Kadence defaults so the operator sees STYLED content
            // for visual review rather than unstyled raw HTML. Path-A
            // documents (claim completeness via DOCTYPE / <html opener)
            // are passed through unchanged. See lib/preview-iframe-wrapper.ts.
            sandbox=""
            srcDoc={wrapForPreview(html)}
            className="mt-2 h-96 w-full rounded border"
            title={`Preview of ${page.title}`}
          />
        </details>
      ) : (
        <p className="text-sm text-muted-foreground">
          No draft HTML yet.
        </p>
      )}

      {lastVisualCritique && (
        <VisualCritiqueBlock entry={lastVisualCritique} />
      )}

      {page.operator_notes && page.operator_notes.trim() !== "" && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Your past notes
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded border bg-muted p-2 text-sm">
            {page.operator_notes}
          </pre>
        </details>
      )}

      {isCurrentAwaitingReview && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRevise}
            disabled={controlState !== "idle"}
          >
            Revise with note
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onApprove}
            disabled={controlState !== "idle"}
          >
            {controlState === "acting" ? "Working…" : "Approve this page"}
          </Button>
        </div>
      )}
    </div>
  );
}

function VisualCritiqueBlock({ entry }: { entry: BriefPageCritiqueEntry }) {
  // critique_log output is the VisualCritique object — see lib/visual-review.
  const critique = entry.output as {
    issues: Array<{ category: string; severity: string; note: string }>;
    overall_notes?: string;
  };
  if (!critique || !Array.isArray(critique.issues)) return null;
  return (
    <div className="rounded border bg-muted/50 p-3 text-sm">
      <p className="font-medium">Visual critique</p>
      {critique.issues.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No issues flagged.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {critique.issues.map((issue, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                  issue.severity === "high"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {issue.severity}
              </span>
              <span>
                <span className="font-medium">{issue.category}:</span>{" "}
                {issue.note}
              </span>
            </li>
          ))}
        </ul>
      )}
      {critique.overall_notes && (
        <p className="mt-2 text-sm text-muted-foreground">
          {critique.overall_notes}
        </p>
      )}
    </div>
  );
}

function ConfirmationModal({
  estimateCents,
  remainingBudgetCents,
  onCancel,
  onConfirm,
  submitting,
}: {
  estimateCents: number;
  remainingBudgetCents: number;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-run-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="confirm-run-title" className="text-lg font-semibold">
          This run will spend a lot of your monthly budget
        </h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>
            Estimated cost:{" "}
            <span className="font-mono font-semibold text-foreground">
              {centsToUsd(estimateCents)}
            </span>
            . Remaining monthly budget:{" "}
            <span className="font-mono font-semibold text-foreground">
              {centsToUsd(remainingBudgetCents)}
            </span>
            .
          </p>
          <p>
            This is more than half of what&apos;s left this month. The run can
            still be cancelled mid-flight; generated pages stay in place.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Keep reviewing
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Starting…" : "Start anyway"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviseModal({
  note,
  onNoteChange,
  onCancel,
  onConfirm,
  submitting,
}: {
  note: string;
  onNoteChange: (s: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revise-note-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="revise-note-title" className="text-lg font-semibold">
          Revise this page with a note
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The runner re-enters this page from the top. Your note goes into
          the prompt for every pass.
        </p>
        <div className="mt-4">
          <label
            htmlFor="revise-note-input"
            className="block text-sm font-medium text-muted-foreground"
          >
            Note for the generator
          </label>
          <Textarea
            id="revise-note-input"
            className="mt-1"
            rows={5}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="e.g. The hero section is too dense. Break into a headline + single CTA with generous whitespace underneath."
            maxLength={2000}
          />
          <p className="mt-1 text-sm text-muted-foreground">
            {note.length} / 2000 characters
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting || note.trim() === ""}
          >
            {submitting ? "Re-queueing…" : "Re-queue with note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
