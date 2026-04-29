import type { CausalDeltaRow } from "@/lib/optimiser/causal/read-deltas";
import { summariseDeltasForReviewPanel } from "@/lib/optimiser/causal/read-deltas";

// "What happened last time we did this" panel — addendum §4.3.
// Server-renderable; consumes the deltas the proposal review page
// fetches with listRecentCausalDeltasForPlaybook.

export function PastCausalDeltasPanel({
  deltas,
  playbookId,
}: {
  deltas: CausalDeltaRow[];
  playbookId: string | null;
}) {
  if (!playbookId) return null;
  const summary = summariseDeltasForReviewPanel(deltas);
  if (summary.count === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        No prior causal deltas for this playbook on this client yet.
        Once the first applied proposal of this type accumulates 14 days
        or 300+ post-rollout sessions, the comparison will appear here.
      </div>
    );
  }
  const friendly = playbookId.replace(/_/g, " ");
  const crSummary =
    summary.avg_cr_pct != null
      ? `${summary.avg_cr_pct >= 0 ? "+" : ""}${(summary.avg_cr_pct * 100).toFixed(1)}% CR`
      : null;
  const scoreSummary =
    summary.avg_score_delta != null
      ? `${summary.avg_score_delta >= 0 ? "+" : ""}${summary.avg_score_delta.toFixed(0)} composite pts`
      : null;
  const confidenceLabel =
    summary.avg_confidence == null
      ? null
      : summary.avg_confidence >= 0.7
        ? "high confidence"
        : summary.avg_confidence >= 0.4
          ? "moderate confidence"
          : "low confidence";
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 text-sm text-emerald-900">
      <p>
        <span className="font-medium">What happened last time:</span>{" "}
        past {summary.count} {friendly} proposal{summary.count === 1 ? "" : "s"} for this client averaged{" "}
        {[crSummary, scoreSummary].filter(Boolean).join(" / ")}
        {confidenceLabel ? ` with ${confidenceLabel}` : ""}.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-emerald-800/80">
        {deltas.slice(0, 3).map((d) => (
          <li key={d.id}>
            ·{" "}
            {d.actual_impact_cr != null
              ? `${d.actual_impact_cr >= 0 ? "+" : ""}${(d.actual_impact_cr * 100).toFixed(1)}% CR`
              : d.actual_impact_score != null
                ? `${d.actual_impact_score >= 0 ? "+" : ""}${d.actual_impact_score} pts`
                : "no measured impact"}{" "}
            on {new Date(d.evaluation_window_end).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </div>
  );
}
