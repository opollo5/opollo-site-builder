"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

const STATUS_LABELS: Record<
  BriefPageStatus,
  { label: string; cls: string }
> = {
  pending: { label: "Pending", cls: "bg-muted text-muted-foreground" },
  generating: {
    label: "Generating",
    cls: "bg-primary/10 text-primary animate-pulse",
  },
  awaiting_review: {
    label: "Awaiting review",
    cls: "bg-yellow-500/10 text-yellow-900 dark:text-yellow-200",
  },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  skipped: { label: "Skipped", cls: "bg-muted text-muted-foreground" },
};

const QUALITY_FLAG_COPY: Record<
  BriefPageQualityFlag,
  { label: string; hint: string; cls: string }
> = {
  cost_ceiling: {
    label: "Cost ceiling hit",
    hint:
      "The visual review halted before converging because this page hit its per-page cost ceiling. The current draft is the best version the runner produced within budget.",
    cls: "bg-orange-500/10 text-orange-900 dark:text-orange-200",
  },
  capped_with_issues: {
    label: "Capped with issues",
    hint:
      "The 2-iteration visual review cap was reached while the critique still flagged severity-high issues. Review the critique notes below before approving.",
    cls: "bg-orange-500/10 text-orange-900 dark:text-orange-200",
  },
};

const RUN_STATUS_LABELS: Record<
  BriefRunSnapshot["status"],
  { label: string; cls: string }
> = {
  queued: { label: "Queued", cls: "bg-primary/10 text-primary" },
  running: {
    label: "Running",
    cls: "bg-primary/10 text-primary animate-pulse",
  },
  paused: {
    label: "Awaiting your review",
    cls: "bg-yellow-500/10 text-yellow-900 dark:text-yellow-200",
  },
  succeeded: { label: "Complete", cls: "bg-emerald-500/10 text-emerald-700" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
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
                <RunStatusPill status={activeRun.status} />
              </>
            )}
            {/* RS-4 — discreet stale indicator. Only renders when the
                last successful poll is more than 8s old (intervalMs * 2),
                so a single late tick doesn't flicker the badge. */}
            {polled.isStale && (
              <span
                role="status"
                className="ml-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
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

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {errorMessage}
        </div>
      )}

      <section
        aria-labelledby="cost-heading"
        className="rounded-lg border p-4"
      >
        <h2 id="cost-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Cost
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Estimate</p>
            <p className="font-mono text-lg">{centsToUsd(estimateCents)}</p>
            <p className="text-xs text-muted-foreground">
              {sortedPages.length} page{sortedPages.length === 1 ? "" : "s"} ·{" "}
              {brief.text_model} / {brief.visual_model}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Remaining this month</p>
            <p className="font-mono text-lg">
              {centsToUsd(remainingBudgetCents)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Spent on this run</p>
            <p className="font-mono text-lg">
              {centsToUsd(Number(activeRun?.run_cost_cents ?? 0))}
            </p>
          </div>
        </div>
      </section>

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
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <p className="font-medium">
            Run failed: <code className="text-xs">{activeRun.failure_code}</code>
          </p>
          {activeRun.failure_detail && (
            <p className="mt-1">{activeRun.failure_detail}</p>
          )}
        </div>
      )}

      <section aria-label="Pages">
        <h2 className="text-lg font-medium">Pages</h2>
        <ol className="mt-3 space-y-3">
          {sortedPages.map((page) => {
            const isExpanded =
              page.page_status === "awaiting_review" ||
              page.page_status === "failed" ||
              page.page_status === "approved";
            return (
              <li
                key={page.id}
                className="rounded-lg border p-4"
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
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
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
                </div>

                {isExpanded && (
                  <PagePreview
                    page={page}
                    briefId={brief.id}
                    isCurrentAwaitingReview={
                      page.page_status === "awaiting_review"
                    }
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
    </div>
  );
}

function RunStatusPill({
  status,
}: {
  status: BriefRunSnapshot["status"];
}) {
  const l = RUN_STATUS_LABELS[status];
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${l.cls}`}
    >
      {l.label}
    </span>
  );
}

function PageStatusPill({ status }: { status: BriefPageStatus }) {
  const l = STATUS_LABELS[status];
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${l.cls}`}
    >
      {l.label}
    </span>
  );
}

function QualityFlagBadge({ flag }: { flag: BriefPageQualityFlag }) {
  const c = QUALITY_FLAG_COPY[flag];
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${c.cls}`}
      title={c.hint}
    >
      ⚠ {c.label}
    </span>
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
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Show rendered preview
          </summary>
          {looksTruncated && (
            <div
              role="alert"
              className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <p className="font-medium">
                This page&apos;s HTML appears truncated.
              </p>
              <p className="mt-1">
                The doc is missing a closing{" "}
                <code className="font-mono">&lt;/body&gt;</code> or{" "}
                <code className="font-mono">&lt;/html&gt;</code> tag, so the
                preview below may render as a blank or solid-coloured frame.
                Review the source carefully or click <em>Revise</em> to
                regenerate.
              </p>
            </div>
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
        <p className="text-xs text-muted-foreground">
          No draft HTML yet.
        </p>
      )}

      {lastVisualCritique && (
        <VisualCritiqueBlock entry={lastVisualCritique} />
      )}

      {page.operator_notes && page.operator_notes.trim() !== "" && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Your past notes
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded border bg-muted p-2 text-xs">
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
        <p className="mt-1 text-xs text-muted-foreground">No issues flagged.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
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
        <p className="mt-2 text-xs text-muted-foreground">
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
            className="block text-xs font-medium text-muted-foreground"
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
          <p className="mt-1 text-xs text-muted-foreground">
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
